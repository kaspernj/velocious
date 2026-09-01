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
     * @param {string} primaryKey - Primary key.
     * @returns {void} - No return value.
     */
    static setPrimaryKey(primaryKey) {
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
     * @returns {string} - The primary key.
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
                    model.setAttribute(foreignKey, this.id());
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
                model.setAttribute(foreignKey, this.id());
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
        const primaryKeyColumn = translationClass.primaryKey();
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
        return this.primaryKey();
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
     * @param {number|string} recordId - Record id.
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
        conditions[this.getModelClass().primaryKey()] = this.id();
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
        const primaryKeyColumn = this.getModelClass().getColumns().find((column) => column.getName() == primaryKey);
        const primaryKeyType = primaryKeyColumn?.getType()?.toLowerCase();
        const driverSupportsDefaultUUID = typeof connection.supportsDefaultPrimaryKeyUUID == "function" && connection.supportsDefaultPrimaryKeyUUID();
        const isUUIDPrimaryKey = primaryKeyType?.includes("uuid");
        const shouldAssignUUIDPrimaryKey = isUUIDPrimaryKey && !driverSupportsDefaultUUID;
        this._setDefaultTimestampValues(data);
        const columnNames = this.getModelClass().getColumnNames();
        const hasUserProvidedPrimaryKey = data[primaryKey] !== undefined && data[primaryKey] !== null && data[primaryKey] !== "";
        if (shouldAssignUUIDPrimaryKey && !hasUserProvidedPrimaryKey) {
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
     * @param {{connection: import("../drivers/base.js").default, data: Record<string, string | number | boolean | Date | null | undefined>, insertResult: Array<Record<string, string | number | boolean | Date | null | undefined>> | null | undefined, primaryKey: string}} options - Pinned insert connection, inserted data, connection result, and primary key column name.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _applyInsertResult({ connection, data, insertResult, primaryKey }) {
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
        /**
         * Conditions.
         * @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const conditions = {};
        conditions[this.getModelClass().primaryKey()] = this.id();
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
            await this._reloadWithId(this.id());
        }
    }
    /**
     * Runs id.
     * @returns {number|string} - The id.
     */
    id() {
        if (!this.getModelClass()._columnNameToAttributeName) {
            throw new Error(`Column names mapping hasn't been set on ${this.constructor.name}. Has the model been initialized?`);
        }
        const primaryKey = this.getModelClass().primaryKey();
        const attributeName = this.getModelClass().getColumnNameToAttributeNameMap()[primaryKey];
        if (attributeName === undefined) {
            throw new Error(`Primary key ${primaryKey} doesn't exist in columns: ${Object.keys(this.getModelClass().getColumnNameToAttributeNameMap()).join(", ")}`);
        }
        return /** @type {number | string} */ (this.readAttribute(attributeName));
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
     * @param {string | number} id - Record identifier.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async _reloadWithId(id) {
        const primaryKey = this.getModelClass().primaryKey();
        /**
         * Where object.
         * @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const whereObject = {};
        whereObject[primaryKey] = id;
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
        const recordId = /** @type {string | number} */ (this.readAttribute("id"));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7O0dBR0c7QUFFSDs7OztHQUlHO0FBRUg7Ozs7R0FJRztBQUVIOzs7R0FHRztBQUVILDhHQUE4RztBQUU5Rzs7O0dBR0c7QUFFSCxPQUFPLGtCQUFrQixFQUFFLEVBQUMscUJBQXFCLEVBQUUsNEJBQTRCLEVBQUUsd0JBQXdCLEVBQUMsTUFBTSw0QkFBNEIsQ0FBQTtBQUM1SSxPQUFPLDZCQUE2QixNQUFNLHdDQUF3QyxDQUFBO0FBQ2xGLE9BQU8scUJBQXFCLE1BQU0sK0JBQStCLENBQUE7QUFDakUsT0FBTyxhQUFhLE1BQU0sd0JBQXdCLENBQUE7QUFDbEQsT0FBTyxPQUFPLE1BQU0sa0JBQWtCLENBQUE7QUFDdEMsT0FBTyxTQUFTLE1BQU0sd0JBQXdCLENBQUE7QUFDOUMsT0FBTyxPQUFPLE1BQU0sZUFBZSxDQUFBO0FBQ25DLE9BQU8sMkJBQTJCLE1BQU0sc0NBQXNDLENBQUE7QUFDOUUsT0FBTyxtQkFBbUIsTUFBTSw2QkFBNkIsQ0FBQTtBQUM3RCxPQUFPLDBCQUEwQixNQUFNLHFDQUFxQyxDQUFBO0FBQzVFLE9BQU8sa0JBQWtCLE1BQU0sNEJBQTRCLENBQUE7QUFDM0QsT0FBTyxzQkFBc0IsTUFBTSx5QkFBeUIsQ0FBQTtBQUM1RCxPQUFPLEtBQUssVUFBVSxNQUFNLFlBQVksQ0FBQTtBQUN4QyxPQUFPLGdCQUFnQixNQUFNLG1DQUFtQyxDQUFBO0FBQ2hFLE9BQU8sZUFBZSxNQUFNLCtCQUErQixDQUFBO0FBQzNELE9BQU8sU0FBUyxNQUFNLHVCQUF1QixDQUFBO0FBQzdDLE9BQU8sRUFBQywyQkFBMkIsRUFBRSwwQkFBMEIsRUFBRSxvQkFBb0IsRUFBRSwwQkFBMEIsRUFBRSx5QkFBeUIsRUFBRSxtQkFBbUIsRUFBQyxNQUFNLGdDQUFn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QUFPLENBQUMsQ0FBQTtnQkFDdkMsQ0FBQztZQUNILENBQUM7UUFDSCxDQUFDO1FBRUQsT0FBTyx1QkFBdUIsQ0FBQTtJQUNoQyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsS0FBSyxDQUFDLE1BQU0sQ0FBQyxrQkFBa0I7UUFDN0IsSUFBSSxrQkFBa0I7WUFBRSxJQUFJLENBQUMsTUFBTSxDQUFDLGtCQUFrQixDQUFDLENBQUE7UUFFdkQsTUFBTSxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUE7SUFDbkIsQ0FBQztDQUNGO0FBRUQsdUJBQXVCLENBQUMscUJBQXFCLENBQUMsUUFBUSxFQUFFLGdCQUFnQixDQUFDLENBQUE7QUFDekUsdUJBQXVCLENBQUMscUJBQXFCLENBQUMsUUFBUSxFQUFFLGdCQUFnQixDQUFDLENBQUE7QUFDekUsdUJBQXVCLENBQUMscUJBQXFCLENBQUMsVUFBVSxFQUFFLGtCQUFrQixDQUFDLENBQUE7QUFDN0UsdUJBQXVCLENBQUMscUJBQXFCLENBQUMsWUFBWSxFQUFFLG9CQUFvQixDQUFDLENBQUE7QUFFakYsT0FBTyxFQUFDLHFCQUFxQixFQUFFLDRCQUE0QixFQUFFLHdCQUF3QixFQUFFLHdCQUF3QixFQUFFLGVBQWUsRUFBQyxDQUFBO0FBQ2pJLGVBQWUsdUJBQXVCLENBQUEiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuLyoqXG4gKiBEZWZpbmVzIHRoaXMgdHlwZWRlZi5cbiAqIEB0eXBlZGVmIHt7dHlwZTogc3RyaW5nLCBtZXNzYWdlOiBzdHJpbmd9fSBWYWxpZGF0aW9uRXJyb3JPYmplY3RUeXBlXG4gKi9cblxuLyoqXG4gKiBMaWZlY3ljbGVDYWxsYmFja1R5cGUgdHlwZS5cbiAqIEB0ZW1wbGF0ZSBbVD1WZWxvY2lvdXNEYXRhYmFzZVJlY29yZF1cbiAqIEB0eXBlZGVmIHsoKG1vZGVsOiBUKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPikgfCBzdHJpbmd9IExpZmVjeWNsZUNhbGxiYWNrVHlwZVxuICovXG5cbi8qKlxuICogTW9kZWwgY2xhc3MgY29uc3RydWN0b3IgdHlwZSB1c2VkIGZvciBzdGF0aWMgYHRoaXNgIHR5cGluZy5cbiAqIEB0ZW1wbGF0ZSBUXG4gKiBAdHlwZWRlZiB7e25ldyAoY2hhbmdlcz86IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogVH19IE1vZGVsQ29uc3RydWN0b3JcbiAqL1xuXG4vKipcbiAqIFJlc3RyaWN0SW5zdGFuY2VSZWxhdGlvbnNoaXAgdHlwZS5cbiAqIEB0eXBlZGVmIHtpbXBvcnQoXCIuL2luc3RhbmNlLXJlbGF0aW9uc2hpcHMvYmFzZS5qc1wiKS5kZWZhdWx0ICYge3F1ZXJ5OiAoKSA9PiBNb2RlbENsYXNzUXVlcnk8dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkPn19IFJlc3RyaWN0SW5zdGFuY2VSZWxhdGlvbnNoaXBcbiAqL1xuXG4vKiogQHR5cGVkZWYge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuVGVuYW50RGF0YWJhc2VQcm92aWRlclR5cGV9IFRlbmFudERhdGFiYXNlUHJvdmlkZXJUeXBlICovXG5cbi8qKlxuICogU2NoZW1hIG1ldGFkYXRhIGNhY2hlZCBmb3Igb25lIHJlY29yZCBjbGFzcyBhbmQgcGh5c2ljYWwgZGF0YWJhc2UgZ2VuZXJhdGlvbi5cbiAqIEB0eXBlZGVmIHtib29sZWFuIHwgbnVsbCB8IHN0cmluZyB8IHVuZGVmaW5lZCB8IFByb21pc2U8dm9pZD4gfCBzdHJpbmdbXSB8IGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS1jb2x1bW4uanNcIikuZGVmYXVsdFtdIHwgaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLXRhYmxlLmpzXCIpLmRlZmF1bHQgfCBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgdW5kZWZpbmVkPiB8IFJlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS1jb2x1bW4uanNcIikuZGVmYXVsdD59IFJlY29yZE1ldGFkYXRhVmFsdWVcbiAqL1xuXG5pbXBvcnQgQWR2aXNvcnlMb2NrUnVubmVyLCB7QWR2aXNvcnlMb2NrQnVzeUVycm9yLCBBZHZpc29yeUxvY2tIb2xkVGltZW91dEVycm9yLCBBZHZpc29yeUxvY2tUaW1lb3V0RXJyb3J9IGZyb20gXCIuLi9hZHZpc29yeS1sb2NrLXJ1bm5lci5qc1wiXG5pbXBvcnQgQmVsb25nc1RvSW5zdGFuY2VSZWxhdGlvbnNoaXAgZnJvbSBcIi4vaW5zdGFuY2UtcmVsYXRpb25zaGlwcy9iZWxvbmdzLXRvLmpzXCJcbmltcG9ydCBCZWxvbmdzVG9SZWxhdGlvbnNoaXAgZnJvbSBcIi4vcmVsYXRpb25zaGlwcy9iZWxvbmdzLXRvLmpzXCJcbmltcG9ydCBDb25maWd1cmF0aW9uIGZyb20gXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCJcbmltcG9ydCBDdXJyZW50IGZyb20gXCIuLi8uLi9jdXJyZW50LmpzXCJcbmltcG9ydCBGcm9tVGFibGUgZnJvbSBcIi4uL3F1ZXJ5L2Zyb20tdGFibGUuanNcIlxuaW1wb3J0IEhhbmRsZXIgZnJvbSBcIi4uL2hhbmRsZXIuanNcIlxuaW1wb3J0IEhhc01hbnlJbnN0YW5jZVJlbGF0aW9uc2hpcCBmcm9tIFwiLi9pbnN0YW5jZS1yZWxhdGlvbnNoaXBzL2hhcy1tYW55LmpzXCJcbmltcG9ydCBIYXNNYW55UmVsYXRpb25zaGlwIGZyb20gXCIuL3JlbGF0aW9uc2hpcHMvaGFzLW1hbnkuanNcIlxuaW1wb3J0IEhhc09uZUluc3RhbmNlUmVsYXRpb25zaGlwIGZyb20gXCIuL2luc3RhbmNlLXJlbGF0aW9uc2hpcHMvaGFzLW9uZS5qc1wiXG5pbXBvcnQgSGFzT25lUmVsYXRpb25zaGlwIGZyb20gXCIuL3JlbGF0aW9uc2hpcHMvaGFzLW9uZS5qc1wiXG5pbXBvcnQgUmVjb3JkQXR0YWNobWVudEhhbmRsZSBmcm9tIFwiLi9hdHRhY2htZW50cy9oYW5kbGUuanNcIlxuaW1wb3J0ICogYXMgaW5mbGVjdGlvbiBmcm9tIFwiaW5mbGVjdGlvblwiXG5pbXBvcnQgZGVidXJyQ29sdW1uTmFtZSBmcm9tIFwiLi4vLi4vdXRpbHMvZGVidXJyLWNvbHVtbi1uYW1lLmpzXCJcbmltcG9ydCBNb2RlbENsYXNzUXVlcnkgZnJvbSBcIi4uL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCJcbmltcG9ydCBQcmVsb2FkZXIgZnJvbSBcIi4uL3F1ZXJ5L3ByZWxvYWRlci5qc1wiXG5pbXBvcnQge3JlYWRQYXlsb2FkQXNzb2NpYXRpb25Db3VudCwgcmVhZFBheWxvYWRDb21wdXRlZEFiaWxpdHksIHJlYWRQYXlsb2FkUXVlcnlEYXRhLCBzZXRQYXlsb2FkQXNzb2NpYXRpb25Db3VudCwgc2V0UGF5bG9hZENvbXB1dGVkQWJpbGl0eSwgc2V0UGF5bG9hZFF1ZXJ5RGF0YX0gZnJvbSBcIi4uLy4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiXG5pbXBvcnQgcmVjb3JkQ2hhbmdlcyBmcm9tIFwiLi4vcmVjb3JkLWNoYW5nZXMuanNcIlxuaW1wb3J0IHJlc3RBcmdzRXJyb3IgZnJvbSBcIi4uLy4uL3V0aWxzL3Jlc3QtYXJncy1lcnJvci5qc1wiXG5pbXBvcnQgc2luZ3VsYXJpemVNb2RlbE5hbWUgZnJvbSBcIi4uLy4uL3V0aWxzL3Npbmd1bGFyaXplLW1vZGVsLW5hbWUuanNcIlxuaW1wb3J0IHtkZWZpbmVNb2RlbFNjb3BlfSBmcm9tIFwiLi4vLi4vdXRpbHMvbW9kZWwtc2NvcGUuanNcIlxuaW1wb3J0IHsgbm9ybWFsaXplRGF0ZVN0cmluZ0ZvcldyaXRlLCBub3JtYWxpemVEYXRlVmFsdWVGb3JSZWFkLCBub3JtYWxpemVEYXRlVmFsdWVGb3JXcml0ZSB9IGZyb20gXCIuLi9kYXRldGltZS1zdG9yYWdlLmpzXCJcbmltcG9ydCB7Zm9ybWF0VmFsdWV9IGZyb20gXCIuLi8uLi91dGlscy9mb3JtYXQtdmFsdWUuanNcIlxuaW1wb3J0IHtjYXB0dXJlQ3JlYXRlQXVkaXRDaGFuZ2VzLCBjYXB0dXJlVXBkYXRlQXVkaXRDaGFuZ2VzLCBjcmVhdGVBdWRpdCwgY3JlYXRlQ3JlYXRlQXVkaXQsIGNyZWF0ZURlc3Ryb3lBdWRpdCwgY3JlYXRlVXBkYXRlQXVkaXQsIGluaXRpYWxpemVBdWRpdGluZywgcmVnaXN0ZXJBdWRpdENhbGxiYWNrLCByZWdpc3RlckF1ZGl0aW5nLCB3aXRob3V0QXVkaXR9IGZyb20gXCIuL2F1ZGl0aW5nLmpzXCJcbmltcG9ydCB7cmVnaXN0ZXJNYWduaXR1ZGVDb3VudGVyQ2FjaGV9IGZyb20gXCIuL2NvdW50ZXItY2FjaGUtbWFnbml0dWRlLmpzXCJcbmltcG9ydCB7c3RhdGVNYWNoaW5lfSBmcm9tIFwiLi9zdGF0ZS1tYWNoaW5lLmpzXCJcbmltcG9ydCBWYWxpZGF0b3JzRm9ybWF0IGZyb20gXCIuL3ZhbGlkYXRvcnMvZm9ybWF0LmpzXCJcbmltcG9ydCBWYWxpZGF0b3JzTGVuZ3RoIGZyb20gXCIuL3ZhbGlkYXRvcnMvbGVuZ3RoLmpzXCJcbmltcG9ydCBWYWxpZGF0b3JzUHJlc2VuY2UgZnJvbSBcIi4vdmFsaWRhdG9ycy9wcmVzZW5jZS5qc1wiXG5pbXBvcnQgVmFsaWRhdG9yc1VuaXF1ZW5lc3MgZnJvbSBcIi4vdmFsaWRhdG9ycy91bmlxdWVuZXNzLmpzXCJcbmltcG9ydCByZWdpc3RlckFjdHNBc0xpc3RDYWxsYmFja3MgZnJvbSBcIi4vYWN0cy1hcy1saXN0LmpzXCJcbmltcG9ydCBUZW5hbnRNb2RlbFNjb3BlIGZyb20gXCIuLi8uLi90ZW5hbnRzL3RlbmFudC1tb2RlbC1zY29wZS5qc1wiXG5pbXBvcnQgVVVJRCBmcm9tIFwicHVyZS11dWlkXCJcblxuLyoqXG4gKiBUcmFuc2xhdGlvbiByZWNvcmQgc2hhcGUgdXNlZCBieSB0cmFuc2xhdGVkIGF0dHJpYnV0ZXMuXG4gKiBAdHlwZWRlZiB7VmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQgJiB7bG9jYWxlOiAoKSA9PiBzdHJpbmd9fSBUcmFuc2xhdGlvbkJhc2VcbiAqL1xuLyoqXG4gKiBBdHRhY2htZW50RHJpdmVyQ29uc3RydWN0b3IgdHlwZS5cbiAqIEB0eXBlZGVmIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkF0dGFjaG1lbnREcml2ZXJDb25zdHJ1Y3Rvcn0gQXR0YWNobWVudERyaXZlckNvbnN0cnVjdG9yXG4gKi9cblxuLyoqIFN0b3JlZCB2YWx1ZXMgdGhhdCBhIGRlY2xhcmVkIGBcImJvb2xlYW5cImAgY2FzdCByZWFkcyBiYWNrIGFzIGB0cnVlYC4gKi9cbmNvbnN0IGRlY2xhcmVkQm9vbGVhblRydXRoeVZhbHVlcyA9IG5ldyBTZXQoWzEsIHRydWUsIFwiMVwiXSlcblxuLyoqIFN0b3JlZCB2YWx1ZXMgdGhhdCBhIGRlY2xhcmVkIGBcImJvb2xlYW5cImAgY2FzdCByZWFkcyBiYWNrIGFzIGBmYWxzZWAuICovXG5jb25zdCBkZWNsYXJlZEJvb2xlYW5GYWxzeVZhbHVlcyA9IG5ldyBTZXQoWzAsIGZhbHNlLCBcIjBcIl0pXG5cbi8qKiBTdGF0aWMgcmVjb3JkIG1ldGFkYXRhIGZpZWxkcyBpc29sYXRlZCBwZXIgcGh5c2ljYWwgZGF0YWJhc2Uvc2NoZW1hIGdlbmVyYXRpb24uICovXG5jb25zdCByZWNvcmRNZXRhZGF0YVByb3BlcnR5TmFtZXMgPSBuZXcgU2V0KFtcbiAgXCJfYXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZVwiLFxuICBcIl9jb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lXCIsXG4gIFwiX2NvbHVtbk5hbWVzXCIsXG4gIFwiX2NvbHVtbnNcIixcbiAgXCJfY29sdW1uc0FzSGFzaFwiLFxuICBcIl9jb2x1bW5UeXBlQnlOYW1lXCIsXG4gIFwiX2RhdGFiYXNlVHlwZVwiLFxuICBcIl9pbml0aWFsaXplZFwiLFxuICBcIl9pbml0aWFsaXplUmVjb3JkUHJvbWlzZVwiLFxuICBcIl90YWJsZVwiXG5dKVxuXG4vKiogQHR5cGUge1dlYWtNYXA8dHlwZW9mIGltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdCwgTWFwPHN0cmluZywgTWFwPHN0cmluZywgUmVjb3JkTWV0YWRhdGFWYWx1ZT4+Pn0gKi9cbmNvbnN0IHJlY29yZE1ldGFkYXRhVmFsdWVzQnlNb2RlbCA9IG5ldyBXZWFrTWFwKClcblxuLyoqXG4gKiBSZXR1cm5zIHRoZSBnZW5lcmF0aW9uLWtleWVkIG1ldGFkYXRhIHN0b3JlIG93bmVkIGJ5IG9uZSBjYW5vbmljYWwgbW9kZWwuXG4gKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBDYW5vbmljYWwgbW9kZWwgY2xhc3MuXG4gKiBAcmV0dXJucyB7TWFwPHN0cmluZywgTWFwPHN0cmluZywgUmVjb3JkTWV0YWRhdGFWYWx1ZT4+fSAtIE1ldGFkYXRhIHN0b3JlLlxuICovXG5mdW5jdGlvbiByZWNvcmRNZXRhZGF0YVZhbHVlc0Zvcihtb2RlbENsYXNzKSB7XG4gIGxldCB2YWx1ZXMgPSByZWNvcmRNZXRhZGF0YVZhbHVlc0J5TW9kZWwuZ2V0KG1vZGVsQ2xhc3MpXG5cbiAgaWYgKCF2YWx1ZXMpIHtcbiAgICB2YWx1ZXMgPSBuZXcgTWFwKClcbiAgICByZWNvcmRNZXRhZGF0YVZhbHVlc0J5TW9kZWwuc2V0KG1vZGVsQ2xhc3MsIHZhbHVlcylcbiAgfVxuXG4gIHJldHVybiB2YWx1ZXNcbn1cblxuY2xhc3MgVmFsaWRhdGlvbkVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgdW5kZWZpbmVkfSAtIFZlbG9jaW91cyBtZXRhZGF0YSBmb3IgZnJvbnRlbmQtbW9kZWwgZXJyb3IgcmVwb3J0aW5nLlxuICAgKi9cbiAgdmVsb2Npb3VzXG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IG1vZGVsLlxuICAgKiBAcmV0dXJucyB7VmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IC0gVGhlIG1vZGVsLlxuICAgKi9cbiAgZ2V0TW9kZWwoKSB7XG4gICAgaWYgKCF0aGlzLl9tb2RlbCkgdGhyb3cgbmV3IEVycm9yKFwiTW9kZWwgaGFzbid0IGJlZW4gc2V0XCIpXG5cbiAgICByZXR1cm4gdGhpcy5fbW9kZWxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBtb2RlbC5cbiAgICogQHBhcmFtIHtWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gbW9kZWwgLSBNb2RlbCBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0TW9kZWwobW9kZWwpIHtcbiAgICB0aGlzLl9tb2RlbCA9IG1vZGVsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdmFsaWRhdGlvbiBlcnJvcnMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBWYWxpZGF0aW9uRXJyb3JPYmplY3RUeXBlW10+fSAtIFRoZSB2YWxpZGF0aW9uIGVycm9ycy5cbiAgICovXG4gIGdldFZhbGlkYXRpb25FcnJvcnMoKSB7XG4gICAgaWYgKCF0aGlzLl92YWxpZGF0aW9uRXJyb3JzKSB0aHJvdyBuZXcgRXJyb3IoXCJWYWxpZGF0aW9uIGVycm9ycyBoYXNuJ3QgYmVlbiBzZXRcIilcblxuICAgIHJldHVybiB0aGlzLl92YWxpZGF0aW9uRXJyb3JzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgdmFsaWRhdGlvbiBlcnJvcnMuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgVmFsaWRhdGlvbkVycm9yT2JqZWN0VHlwZVtdPn0gdmFsaWRhdGlvbkVycm9ycyAtIFZhbGlkYXRpb24gZXJyb3JzIHRvIGFzc2lnbi5cbiAgICovXG4gIHNldFZhbGlkYXRpb25FcnJvcnModmFsaWRhdGlvbkVycm9ycykge1xuICAgIHRoaXMuX3ZhbGlkYXRpb25FcnJvcnMgPSB2YWxpZGF0aW9uRXJyb3JzXG4gIH1cbn1cblxuLyoqXG4gKiBSdW5zIGFwcGx5IGJ1aWx0IHJlY29yZCBpbnZlcnNlIHJlbGF0aW9uc2hpcC5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucy5cbiAqIEBwYXJhbSB7VmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IGFyZ3MucGFyZW50IC0gUGFyZW50IHJlY29yZCBiZWluZyBidWlsdCBmcm9tLlxuICogQHBhcmFtIHt7Z2V0UmVsYXRpb25zaGlwQnlOYW1lOiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZFtcImdldFJlbGF0aW9uc2hpcEJ5TmFtZVwiXX19IGFyZ3MucmVjb3JkIC0gTmV3bHkgYnVpbHQgcmVsYXRlZCByZWNvcmQuXG4gKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZCB8IG51bGx9IGFyZ3MuaW52ZXJzZU9mIC0gSW52ZXJzZSByZWxhdGlvbnNoaXAgbmFtZS5cbiAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5hbGxvd0hhc01hbnkgLSBXaGV0aGVyIGEgaGFzLW1hbnkgaW52ZXJzZSBzaG91bGQgYmUgYXBwZW5kZWQuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gYXBwbHlCdWlsdFJlY29yZEludmVyc2VSZWxhdGlvbnNoaXAoe2FsbG93SGFzTWFueSwgaW52ZXJzZU9mLCBwYXJlbnQsIHJlY29yZH0pIHtcbiAgaWYgKCFpbnZlcnNlT2YpIHJldHVyblxuXG4gIGNvbnN0IGludmVyc2VJbnN0YW5jZVJlbGF0aW9uc2hpcCA9IHJlY29yZC5nZXRSZWxhdGlvbnNoaXBCeU5hbWUoaW52ZXJzZU9mKVxuXG4gIGludmVyc2VJbnN0YW5jZVJlbGF0aW9uc2hpcC5zZXRBdXRvU2F2ZShmYWxzZSlcblxuICBpZiAoIWFsbG93SGFzTWFueSB8fCBpbnZlcnNlSW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0VHlwZSgpID09IFwiaGFzT25lXCIpIHtcbiAgICBpbnZlcnNlSW5zdGFuY2VSZWxhdGlvbnNoaXAuc2V0TG9hZGVkKHBhcmVudClcbiAgICByZXR1cm5cbiAgfVxuXG4gIGlmIChpbnZlcnNlSW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0VHlwZSgpID09IFwiaGFzTWFueVwiKSB7XG4gICAgaW52ZXJzZUluc3RhbmNlUmVsYXRpb25zaGlwLmFkZFRvTG9hZGVkKHBhcmVudClcbiAgICByZXR1cm5cbiAgfVxuXG4gIHRocm93IG5ldyBFcnJvcihgVW5rbm93biByZWxhdGlvbnNoaXAgdHlwZTogJHtpbnZlcnNlSW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0VHlwZSgpfWApXG59XG5cbi8qKlxuICogQnVpbGQgYSByZWxhdGVkIHJlY29yZCBhbmQgd2lyZSBpdHMgaW52ZXJzZSByZWxhdGlvbnNoaXAgdG8gdGhlIHBhcmVudC5cbiAqIEBwYXJhbSB7VmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IHBhcmVudCAtIFBhcmVudCByZWNvcmQgYnVpbGRpbmcgdGhlIHJlbGF0aW9uc2hpcC5cbiAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUgYmVpbmcgYnVpbHQuXG4gKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXR0cmlidXRlcyAtIEF0dHJpYnV0ZXMgZm9yIHRoZSBuZXcgcmVsYXRlZCByZWNvcmQuXG4gKiBAcGFyYW0ge2Jvb2xlYW59IGFsbG93SGFzTWFueSAtIFdoZXRoZXIgaGFzLW1hbnkgaW52ZXJzZSByZWxhdGlvbnNoaXBzIHNob3VsZCBhcHBlbmQgdGhlIHBhcmVudC5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gQnVpbHQgcmVsYXRlZCByZWNvcmQuXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkUmVsYXRlZFJlY29yZFdpdGhJbnZlcnNlKHBhcmVudCwgcmVsYXRpb25zaGlwTmFtZSwgYXR0cmlidXRlcywgYWxsb3dIYXNNYW55KSB7XG4gIGNvbnN0IGluc3RhbmNlUmVsYXRpb25zaGlwID0gcGFyZW50LmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuICBjb25zdCByZWNvcmQgPSBpbnN0YW5jZVJlbGF0aW9uc2hpcC5idWlsZChhdHRyaWJ1dGVzKVxuICBjb25zdCBpbnZlcnNlT2YgPSBpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRSZWxhdGlvbnNoaXAoKS5nZXRJbnZlcnNlT2YoKVxuXG4gIGFwcGx5QnVpbHRSZWNvcmRJbnZlcnNlUmVsYXRpb25zaGlwKHtcbiAgICBhbGxvd0hhc01hbnksXG4gICAgaW52ZXJzZU9mLFxuICAgIHBhcmVudCxcbiAgICByZWNvcmQ6IC8qKiBAdHlwZSB7e2dldFJlbGF0aW9uc2hpcEJ5TmFtZTogVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmRbXCJnZXRSZWxhdGlvbnNoaXBCeU5hbWVcIl19fSAqLyAocmVjb3JkKVxuICB9KVxuXG4gIHJldHVybiByZWNvcmRcbn1cblxuY2xhc3MgVGVuYW50RGF0YWJhc2VTY29wZUVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1lc3NhZ2UgLSBFcnJvciBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge3ttb2RlbE5hbWU6IHN0cmluZ319IGFyZ3MgLSBDb250ZXh0IGZvciB0aGUgZmFpbGVkIHRlbmFudC1zY29wZWQgbW9kZWwuXG4gICAqL1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlLCB7bW9kZWxOYW1lfSkge1xuICAgIHN1cGVyKG1lc3NhZ2UpXG4gICAgdGhpcy5uYW1lID0gXCJUZW5hbnREYXRhYmFzZVNjb3BlRXJyb3JcIlxuICAgIHRoaXMubW9kZWxOYW1lID0gbW9kZWxOYW1lXG4gIH1cbn1cblxuLyoqXG4gKiBCYXNlIGRhdGFiYXNlIHJlY29yZC5cbiAqIEB0ZW1wbGF0ZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBbV3JpdGVBdHRyaWJ1dGVzPVJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pl1cbiAqL1xuY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQge1xuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZz4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBfYXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZSA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZz4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBfY29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZSA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIG9iamVjdD4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBfdHJhbnNsYXRpb25zID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi92YWxpZGF0b3JzL2Jhc2UuanNcIikuZGVmYXVsdFtdPiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIF92YWxpZGF0b3JzID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgTGlmZWN5Y2xlQ2FsbGJhY2tUeXBlW10+IHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgX2xpZmVjeWNsZUNhbGxiYWNrcyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHR5cGVvZiBpbXBvcnQoXCIuL3ZhbGlkYXRvcnMvYmFzZS5qc1wiKS5kZWZhdWx0PiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIF92YWxpZGF0b3JUeXBlcyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHtkcml2ZXI/OiBzdHJpbmcgfCBBdHRhY2htZW50RHJpdmVyQ29uc3RydWN0b3IgfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIHR5cGU6IFwiaGFzT25lXCIgfCBcImhhc01hbnlcIn0+IHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgX2F0dGFjaG1lbnRzTWFwID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdD4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBfcmVsYXRpb25zaGlwcyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL3F1ZXJ5L3F1ZXJ5LWRhdGEuanNcIikuUXVlcnlEYXRhRm4+IHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgX3F1ZXJ5RGF0YVJlZ2lzdHJhdGlvbnMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB7YWxsb3dEZXN0cm95PzogYm9vbGVhbiwgbGltaXQ/OiBudW1iZXIsIHJlamVjdElmPzogKGF0dHJpYnV0ZXM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gYm9vbGVhbn0+IHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgX2FjY2VwdGVkTmVzdGVkQXR0cmlidXRlcyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZz4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBfYXR0cmlidXRlQ2FzdHMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UtY29sdW1uLmpzXCIpLmRlZmF1bHQ+IHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgX2NvbHVtbnNBc0hhc2ggPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtBcnJheTxzdHJpbmc+IHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgX2NvbHVtbk5hbWVzID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIF9jb2x1bW5UeXBlQnlOYW1lID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge3N0cmluZyB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIG1vZGVsTmFtZVxuXG4gIC8qKlxuICAgKiBPcHQtaW4gY2xpZW50IHN5bmMgZGVjbGFyYXRpb24gY29uc3VtZWQgYnkgYFN5bmNDbGllbnQuZnJvbUNvbmZpZ3VyYXRpb24oLi4uKWAuXG4gICAqIERlY2xhcmUgYHN0YXRpYyBzeW5jID0gdHJ1ZWAgKGFsbCBkZWZhdWx0cykgb3IgYSBkZWNsYXJhdGlvbiBvYmplY3QgbGlrZVxuICAgKiBgc3RhdGljIHN5bmMgPSB7dHJhY2s6IFtcImNyZWF0ZVwiLCBcInVwZGF0ZVwiXSwgc3luY1R5cGU6IFwidXBzZXJ0XCJ9YCB0byBoYXZlIHRoZVxuICAgKiBzeW5jIGNsaWVudCBhdXRvLWRpc2NvdmVyIHRoaXMgbW9kZWwgYW5kIGRlcml2ZSBpdHMgcmVzb3VyY2UgY29uZmlnIGZyb21cbiAgICogY29sdW1uIG1ldGFkYXRhLlxuICAgKiBAdHlwZSB7aW1wb3J0KFwiLi4vLi4vc3luYy9zeW5jLWNsaWVudC10eXBlcy5qc1wiKS5Nb2RlbFN5bmNEZWNsYXJhdGlvbiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIHN5bmNcblxuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7UHJvbWlzZTx2b2lkPiB8IG51bGwgfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBfaW5pdGlhbGl6ZVJlY29yZFByb21pc2VcblxuICAvKiogQHR5cGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZCB8IHVuZGVmaW5lZH0gQ2Fub25pY2FsIG1vZGVsIGNsYXNzIGV4cG9zZWQgb25seSBieSBhbiBvcGVyYXRpb24tYm91bmQgbWV0YWRhdGEgcHJveHkuICovXG4gIHN0YXRpYyBfcmVjb3JkTWV0YWRhdGFNb2RlbENsYXNzXG5cbiAgLyoqIEB0eXBlIHsoKG1vZGVsQ2xhc3M6IHR5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZCkgPT4gdHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkKSB8IHVuZGVmaW5lZH0gQmluZHMgcmVsYXRlZCBnZW5lcmF0ZWQgbW9kZWwgY2xhc3NlcyB0byB0aGUgc2FtZSBvcGVyYXRpb24gbWV0YWRhdGEgZ2VuZXJhdGlvbi4gKi9cbiAgc3RhdGljIF9yZWNvcmRNZXRhZGF0YUJpbmRlclxuXG4gIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vb3BlcmF0aW9uLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IE9wZXJhdGlvbiBleHBvc2VkIG9ubHkgYnkgYSBjb25zdHJ1Y3RpbmcgbWV0YWRhdGEgcHJveHkuICovXG4gIHN0YXRpYyBfcmVjb3JkTWV0YWRhdGFPcGVyYXRpb25cblxuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7Ym9vbGVhbiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIF9lYWdlckxvYWRSZWNvcmRNZXRhZGF0YVxuXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL2F1ZGl0aW5nLmpzXCIpLkF1ZGl0Q2FsbGJhY2tbXT4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBfYXVkaXRDYWxsYmFja3NcblxuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7Ym9vbGVhbiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIF9hdWRpdExpZmVjeWNsZUNhbGxiYWNrc1JlZ2lzdGVyZWRcblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgbW9kZWwgbmFtZSwgcHJlZmVycmluZyBhbiBleHBsaWNpdCBgc3RhdGljIG1vZGVsTmFtZWAgZGVjbGFyYXRpb25cbiAgICogb3ZlciB0aGUgSmF2YVNjcmlwdCBjbGFzcyBgLm5hbWVgIHByb3BlcnR5LiBUaGlzIGFsbG93cyBtaW5pZmllZCBidWlsZHMgdG9cbiAgICogcHJlc2VydmUgY29ycmVjdCBtb2RlbCBuYW1lcyB3aXRob3V0IHJlbHlpbmcgb24gYGtlZXBfY2xhc3NuYW1lc2AuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIG1vZGVsIG5hbWUuXG4gICAqL1xuICBzdGF0aWMgZ2V0TW9kZWxOYW1lKCkge1xuICAgIGlmICh0eXBlb2YgdGhpcy5tb2RlbE5hbWUgPT09IFwic3RyaW5nXCIgJiYgdGhpcy5tb2RlbE5hbWUubGVuZ3RoID4gMCkgcmV0dXJuIHRoaXMubW9kZWxOYW1lXG5cbiAgICByZXR1cm4gdGhpcy5uYW1lXG4gIH1cblxuICBzdGF0aWMgZ2V0QXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCgpIHtcbiAgICBpZiAoIXRoaXMuX2F0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWUpIHtcbiAgICAgIC8qKlxuICAgICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZz59ICovXG4gICAgICB0aGlzLl9hdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lID0ge31cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fYXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBkYXRhYmFzZSBjb2x1bW4gbmFtZSBmb3IgYSByZWNvcmQgYXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUgdG8gcmVzb2x2ZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBNYXBwZWQgY29sdW1uIG5hbWUsIG9yIHRoZSB1bmRlcnNjb3JlZCBhdHRyaWJ1dGUgbmFtZSB3aGVuIG5vIG1hcHBpbmcgZXhpc3RzLlxuICAgKi9cbiAgc3RhdGljIGdldENvbHVtbk5hbWVGb3JBdHRyaWJ1dGVOYW1lKGF0dHJpYnV0ZU5hbWUpIHtcbiAgICBjb25zdCByZXNvbHZlZEF0dHJpYnV0ZU5hbWUgPSB0aGlzLnJlc29sdmVBdHRyaWJ1dGVOYW1lKGF0dHJpYnV0ZU5hbWUpXG5cbiAgICBpZiAocmVzb2x2ZWRBdHRyaWJ1dGVOYW1lKSByZXR1cm4gdGhpcy5nZXRBdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwKClbcmVzb2x2ZWRBdHRyaWJ1dGVOYW1lXVxuXG4gICAgcmV0dXJuIGluZmxlY3Rpb24udW5kZXJzY29yZShpbmZsZWN0aW9uLmNhbWVsaXplKGRlYnVyckNvbHVtbk5hbWUoYXR0cmlidXRlTmFtZSksIHRydWUpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIGFuIGluY29taW5nIGF0dHJpYnV0ZSBvciBjb2x1bW4gbmFtZSB0byB0aGUgY2Fub25pY2FsIGF0dHJpYnV0ZSBuYW1lIHRoaXMgbW9kZWwgZXhwb3Nlcy5cbiAgICogQWNjZXB0cyB0aGUgY2Fub25pY2FsIChkZWJ1cnJlZCkgYXR0cmlidXRlIG5hbWUsIGEgcmF3IHVtbGF1dC9hY3JvbnltIGNvbHVtbiBuYW1lLCBhIHByZS1kZWJ1cnJcbiAgICogY2FtZWxpemF0aW9uLCBhbmQgY2FtZWxDYXNlIGNhc2luZyB2YXJpYW50cyAoZS5nLiBcInZBRnVua3Rpb25JRFwiIHZzIFwidkFGdW5rdGlvbmlkXCIpLiBSZXR1cm5zIG51bGxcbiAgICogd2hlbiBub3RoaW5nIG1hdGNoZXMsIHNvIGNhbGxlcnMga2VlcCB0aGVpciBvd24gbm90LWZvdW5kIGhhbmRsaW5nLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIEF0dHJpYnV0ZSBuYW1lIG9yIGNvbHVtbiBuYW1lIHRvIHJlc29sdmUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSAtIENhbm9uaWNhbCBhdHRyaWJ1dGUgbmFtZSwgb3IgbnVsbC5cbiAgICovXG4gIHN0YXRpYyByZXNvbHZlQXR0cmlidXRlTmFtZShuYW1lKSB7XG4gICAgY29uc3QgYXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCA9IHRoaXMuZ2V0QXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCgpXG5cbiAgICBpZiAobmFtZSBpbiBhdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwKSByZXR1cm4gbmFtZVxuXG4gICAgY29uc3Qgbm9ybWFsaXplZEF0dHJpYnV0ZU5hbWUgPSBpbmZsZWN0aW9uLmNhbWVsaXplKGRlYnVyckNvbHVtbk5hbWUobmFtZSksIHRydWUpXG5cbiAgICBpZiAobm9ybWFsaXplZEF0dHJpYnV0ZU5hbWUgaW4gYXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCkgcmV0dXJuIG5vcm1hbGl6ZWRBdHRyaWJ1dGVOYW1lXG5cbiAgICBjb25zdCBjb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwID0gdGhpcy5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKClcblxuICAgIGlmIChuYW1lIGluIGNvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXApIHJldHVybiBjb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwW25hbWVdXG5cbiAgICAvLyBGaW5hbCBmYWxsYmFjazogbWF0Y2ggY2FtZWxDYXNlIGNhc2luZyB2YXJpYW50cyBhZ2FpbnN0IHRoZSBtb2RlbCdzIGdlbmVyYXRlZCBhY2Nlc3NvcnMuIFRoZXNlXG4gICAgLy8gZXhpc3Qgb24gdGhlIHByb3RvdHlwZSBiZWZvcmUgcnVudGltZSBpbml0aWFsaXphdGlvbiAodW5saWtlIHRoZSBhdHRyaWJ1dGUgbWFwKSwgc28gdGhpcyBhbHNvXG4gICAgLy8gcmVzb2x2ZXMgbmFtZXMgbG9va2VkIHVwIGR1cmluZyBjcmVhdGUsIGJlZm9yZSB0aGUgbWFwIGlzIGJ1aWx0LiBpbmZsZWN0aW9uIGxvd2VyLWNhc2VzIHRyYWlsaW5nXG4gICAgLy8gYWNyb255bXMgKFwiSURcIiAtPiBcImlkXCIpLCBzbyBcInZBRnVua3Rpb25JRFwiL1wiVkFfRnVua3Rpb25JRFwiIHN0aWxsIHJlc29sdmUgdG8gXCJ2QUZ1bmt0aW9uaWRcIi5cbiAgICBjb25zdCBsb3dlck5vcm1hbGl6ZWRBdHRyaWJ1dGVOYW1lID0gbm9ybWFsaXplZEF0dHJpYnV0ZU5hbWUudG9Mb3dlckNhc2UoKVxuICAgIGxldCBwcm90b3R5cGUgPSB0aGlzLnByb3RvdHlwZVxuXG4gICAgd2hpbGUgKHByb3RvdHlwZSAmJiBwcm90b3R5cGUgIT09IE9iamVjdC5wcm90b3R5cGUpIHtcbiAgICAgIGZvciAoY29uc3QgYWNjZXNzb3JOYW1lIG9mIE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzKHByb3RvdHlwZSkpIHtcbiAgICAgICAgaWYgKGFjY2Vzc29yTmFtZS50b0xvd2VyQ2FzZSgpID09PSBsb3dlck5vcm1hbGl6ZWRBdHRyaWJ1dGVOYW1lKSByZXR1cm4gYWNjZXNzb3JOYW1lXG4gICAgICB9XG5cbiAgICAgIHByb3RvdHlwZSA9IE9iamVjdC5nZXRQcm90b3R5cGVPZihwcm90b3R5cGUpXG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBGaW5kcyB0aGUgbWVtYmVyIG5hbWUgb24gYSB0YXJnZXQncyBwcm90b3R5cGUgY2hhaW4gbWF0Y2hpbmcgYG1lbWJlck5hbWVgLCBmYWxsaW5nIGJhY2sgdG8gYVxuICAgKiBjYXNlLWluc2Vuc2l0aXZlIG1hdGNoLiBSZXNvbHZlcyBzZXR0ZXJzIHdoZW4gYSByZWFkLW9ubHkgYXR0cmlidXRlIGFsaWFzIGRpZmZlcnMgb25seSBpbiBjYW1lbENhc2VcbiAgICogY2FzaW5nIGZyb20gdGhlIGdlbmVyYXRlZCBhY2Nlc3NvciAoZS5nLiBhIFwidkFGdW5rdGlvbklEXCIgYWxpYXMgd2hvc2Ugc2V0dGVyIGlzIFwic2V0VkFGdW5rdGlvbmlkXCIpLlxuICAgKiBAcGFyYW0ge29iamVjdH0gdGFyZ2V0IC0gSW5zdGFuY2Ugb3IgcHJvdG90eXBlIHRvIHNlYXJjaC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1lbWJlck5hbWUgLSBNZW1iZXIgbmFtZSB0byBmaW5kLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBNYXRjaGluZyBtZW1iZXIgbmFtZSwgb3IgbnVsbCB3aGVuIGFic2VudC5cbiAgICovXG4gIHN0YXRpYyBmaW5kTWVtYmVyTmFtZUluc2Vuc2l0aXZlKHRhcmdldCwgbWVtYmVyTmFtZSkge1xuICAgIGlmIChtZW1iZXJOYW1lIGluIHRhcmdldCkgcmV0dXJuIG1lbWJlck5hbWVcblxuICAgIGNvbnN0IGxvd2VyTWVtYmVyTmFtZSA9IG1lbWJlck5hbWUudG9Mb3dlckNhc2UoKVxuICAgIGxldCBjdXJyZW50ID0gdGFyZ2V0XG5cbiAgICB3aGlsZSAoY3VycmVudCAmJiBjdXJyZW50ICE9PSBPYmplY3QucHJvdG90eXBlKSB7XG4gICAgICBmb3IgKGNvbnN0IGNhbmRpZGF0ZU5hbWUgb2YgT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMoY3VycmVudCkpIHtcbiAgICAgICAgaWYgKGNhbmRpZGF0ZU5hbWUudG9Mb3dlckNhc2UoKSA9PT0gbG93ZXJNZW1iZXJOYW1lKSByZXR1cm4gY2FuZGlkYXRlTmFtZVxuICAgICAgfVxuXG4gICAgICBjdXJyZW50ID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKGN1cnJlbnQpXG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlZmluZSBzY29wZS5cbiAgICogQHBhcmFtIHsoLi4uYXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gY2FsbGJhY2sgLSBTY29wZSBjYWxsYmFjay5cbiAgICogQHJldHVybnMgeygoLi4uYXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBpbXBvcnQoXCIuLi9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZD4pICYge3Njb3BlOiAoLi4uYXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBpbXBvcnQoXCIuLi8uLi91dGlscy9tb2RlbC1zY29wZS5qc1wiKS5Nb2RlbFNjb3BlRGVzY3JpcHRvcn19IC0gU2NvcGUgaGVscGVyLlxuICAgKi9cbiAgc3RhdGljIGRlZmluZVNjb3BlKGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIGRlZmluZU1vZGVsU2NvcGUoe1xuICAgICAgY2FsbGJhY2ssXG4gICAgICBtb2RlbENsYXNzOiB0aGlzLFxuICAgICAgc3RhcnRRdWVyeTogKG1vZGVsQ2xhc3MgPSB0aGlzKSA9PiB7XG4gICAgICAgIC8vIFRoaXMgYmFja2VuZCBzY29wZSBmYWN0b3J5IGNhbiBvbmx5IGJlIGludm9rZWQgdGhyb3VnaCBhIERhdGFiYXNlUmVjb3JkIGNsYXNzLlxuICAgICAgICBjb25zdCBCYWNrZW5kTW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSAqLyAobW9kZWxDbGFzcylcblxuICAgICAgICByZXR1cm4gQmFja2VuZE1vZGVsQ2xhc3MuX25ld1F1ZXJ5KClcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGFwcGxpY2F0aW9uIG1vZGVsIGNsYXNzIGJlaGluZCBhbiBvcGVyYXRpb24tYm91bmQgbWV0YWRhdGEgdmlldy5cbiAgICogQHJldHVybnMge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gLSBDYW5vbmljYWwgbW9kZWwgY2xhc3MuXG4gICAqL1xuICBzdGF0aWMgY2Fub25pY2FsUmVjb3JkTWV0YWRhdGFNb2RlbENsYXNzKCkge1xuICAgIHJldHVybiB0aGlzLl9yZWNvcmRNZXRhZGF0YU1vZGVsQ2xhc3MgfHwgdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIEJpbmRzIGEgcmVsYXRpb25zaGlwIHRhcmdldCB0byB0aGlzIG1vZGVsIGNsYXNzJ3MgbWV0YWRhdGEgZ2VuZXJhdGlvbi5cbiAgICogQHBhcmFtIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IG1vZGVsQ2xhc3MgLSBSZWxhdGlvbnNoaXAgdGFyZ2V0LlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSAtIEdlbmVyYXRpb24tYm91bmQgdGFyZ2V0LCBvciB0aGUgdW5jaGFuZ2VkIHRhcmdldCBmb3IgbGVnYWN5IHF1ZXJpZXMuXG4gICAqL1xuICBzdGF0aWMgYmluZFJlY29yZE1ldGFkYXRhTW9kZWxDbGFzcyhtb2RlbENsYXNzKSB7XG4gICAgcmV0dXJuIHRoaXMuX3JlY29yZE1ldGFkYXRhQmluZGVyID8gdGhpcy5fcmVjb3JkTWV0YWRhdGFCaW5kZXIobW9kZWxDbGFzcykgOiBtb2RlbENsYXNzXG4gIH1cblxuICBzdGF0aWMgZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCgpIHtcbiAgICBpZiAoIXRoaXMuX2NvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWUpIHtcbiAgICAgIC8qKlxuICAgICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZz59ICovXG4gICAgICB0aGlzLl9jb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lID0ge31cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fY29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZVxuICB9XG5cbiAgc3RhdGljIGdldFRyYW5zbGF0aW9uc01hcCgpIHtcbiAgICBpZiAoIXRoaXMuX3RyYW5zbGF0aW9ucykge1xuICAgICAgLyoqXG4gICAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgb2JqZWN0Pn0gKi9cbiAgICAgIHRoaXMuX3RyYW5zbGF0aW9ucyA9IHt9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX3RyYW5zbGF0aW9uc1xuICB9XG5cbiAgc3RhdGljIGdldFZhbGlkYXRvcnNNYXAoKSB7XG4gICAgaWYgKCF0aGlzLl92YWxpZGF0b3JzKSB7XG4gICAgICAvKipcbiAgICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3ZhbGlkYXRvcnMvYmFzZS5qc1wiKS5kZWZhdWx0W10+fSAqL1xuICAgICAgdGhpcy5fdmFsaWRhdG9ycyA9IHt9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX3ZhbGlkYXRvcnNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBsaWZlY3ljbGUgY2FsbGJhY2tzIG1hcC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIExpZmVjeWNsZUNhbGxiYWNrVHlwZVtdPn0gLSBMaWZlY3ljbGUgY2FsbGJhY2tzIGtleWVkIGJ5IG5hbWUuXG4gICAqL1xuICBzdGF0aWMgZ2V0TGlmZWN5Y2xlQ2FsbGJhY2tzTWFwKCkge1xuICAgIGlmICghdGhpcy5fbGlmZWN5Y2xlQ2FsbGJhY2tzKSB7XG4gICAgICAvKipcbiAgICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBMaWZlY3ljbGVDYWxsYmFja1R5cGVbXT59ICovXG4gICAgICB0aGlzLl9saWZlY3ljbGVDYWxsYmFja3MgPSB7fVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9saWZlY3ljbGVDYWxsYmFja3NcbiAgfVxuXG4gIHN0YXRpYyBnZXRWYWxpZGF0b3JUeXBlc01hcCgpIHtcbiAgICBpZiAoIXRoaXMuX3ZhbGlkYXRvclR5cGVzKSB7XG4gICAgICAvKipcbiAgICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB0eXBlb2YgaW1wb3J0KFwiLi92YWxpZGF0b3JzL2Jhc2UuanNcIikuZGVmYXVsdD59ICovXG4gICAgICB0aGlzLl92YWxpZGF0b3JUeXBlcyA9IHt9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX3ZhbGlkYXRvclR5cGVzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYXR0YWNobWVudHMgbWFwLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywge2RyaXZlcj86IHN0cmluZyB8IEF0dGFjaG1lbnREcml2ZXJDb25zdHJ1Y3RvciB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgdHlwZTogXCJoYXNPbmVcIiB8IFwiaGFzTWFueVwifT59IC0gQXR0YWNobWVudCBkZWZpbml0aW9ucyBrZXllZCBieSBuYW1lLlxuICAgKi9cbiAgc3RhdGljIGdldEF0dGFjaG1lbnRzTWFwKCkge1xuICAgIGlmICghdGhpcy5fYXR0YWNobWVudHNNYXApIHtcbiAgICAgIC8qKlxuICAgICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIHtkcml2ZXI/OiBzdHJpbmcgfCBBdHRhY2htZW50RHJpdmVyQ29uc3RydWN0b3IgfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIHR5cGU6IFwiaGFzT25lXCIgfCBcImhhc01hbnlcIn0+fSAqL1xuICAgICAgdGhpcy5fYXR0YWNobWVudHNNYXAgPSB7fVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9hdHRhY2htZW50c01hcFxuICB9XG5cbiAgLyoqXG4gICAqIEF0dHJpYnV0ZXMuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gIF9hdHRyaWJ1dGVzID0ge31cblxuICAvKipcbiAgICogQ2hhbmdlcy5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgX2NoYW5nZXMgPSB7fVxuXG4gIC8qKlxuICAgKiBDaGFuZ2VzIGNhcHR1cmVkIGJlZm9yZSBhIGNyZWF0ZSBhdWRpdCBpcyB3cml0dGVuLlxuICAgKiBAdHlwZSB7aW1wb3J0KFwiLi9hdWRpdGluZy5qc1wiKS5BdWRpdENoYW5nZXMgfCB1bmRlZmluZWR9ICovXG4gIF9wZW5kaW5nQ3JlYXRlQXVkaXRDaGFuZ2VzID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIENoYW5nZXMgY2FwdHVyZWQgYmVmb3JlIGFuIHVwZGF0ZSBhdWRpdCBpcyB3cml0dGVuLlxuICAgKiBAdHlwZSB7aW1wb3J0KFwiLi9hdWRpdGluZy5qc1wiKS5BdWRpdENoYW5nZXMgfCB1bmRlZmluZWR9ICovXG4gIF9wZW5kaW5nVXBkYXRlQXVkaXRDaGFuZ2VzID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIEF0dHJpYnV0ZSBuYW1lcyBleHBsaWNpdGx5IGFzc2lnbmVkIGluIHRoZSBjdXJyZW50IHVwZGF0ZSBjYWxsLlxuICAgKiBAdHlwZSB7U2V0PHN0cmluZz4gfCB1bmRlZmluZWR9XG4gICAqL1xuICBfYXNzaWduZWRBdHRyaWJ1dGVOYW1lcyA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBDb2x1bW5zIGFzIGhhc2guXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UtY29sdW1uLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICBfY29sdW1uc0FzSGFzaCA9IHt9XG5cbiAgLyoqXG4gICAqIENvbm5lY3Rpb24uXG4gICAqIEB0eXBlIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gKi9cbiAgX19jb25uZWN0aW9uID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIEV4cGxpY2l0IG9wZXJhdGlvbiBvd25pbmcgdGhpcyByZWNvcmQncyBkYXRhYmFzZSB3b3JrLlxuICAgKiBAdHlwZSB7aW1wb3J0KFwiLi4vb3BlcmF0aW9uLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9ICovXG4gIF9kYXRhYmFzZU9wZXJhdGlvbiA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBJbnN0YW5jZSByZWxhdGlvbnNoaXBzLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9pbnN0YW5jZS1yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdD59ICovXG4gIF9pbnN0YW5jZVJlbGF0aW9uc2hpcHMgPSB7fVxuICAvKipcbiAgICogQXR0YWNobWVudHMuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZWNvcmRBdHRhY2htZW50SGFuZGxlPn0gKi9cbiAgX2F0dGFjaG1lbnRzID0ge31cblxuICAvKipcbiAgICogTG9hZCBjb2hvcnQuXG4gICAqIEB0eXBlIHtBcnJheTxWZWxvY2lvdXNEYXRhYmFzZVJlY29yZD4gfCB1bmRlZmluZWR9IC0gU2hhcmVkIHJlZmVyZW5jZSB0byBzaWJsaW5nIHJlY29yZHMgbG9hZGVkIGluIHRoZSBzYW1lIGJhdGNoLiBVc2VkIGJ5IGF1dG8tcHJlbG9hZC5cbiAgICovXG4gIF9sb2FkQ29ob3J0ID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIFRhYmxlIG5hbWUuXG4gICAqIEB0eXBlIHtzdHJpbmcgfCB1bmRlZmluZWR9ICovXG4gIF9fdGFibGVOYW1lID0gdW5kZWZpbmVkXG5cbiAgLyoqXG4gICAqIFZhbGlkYXRpb24gZXJyb3JzLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgVmFsaWRhdGlvbkVycm9yT2JqZWN0VHlwZVtdPn0gKi9cbiAgX3ZhbGlkYXRpb25FcnJvcnMgPSB7fVxuXG4gIHN0YXRpYyB2YWxpZGF0b3JUeXBlcygpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRWYWxpZGF0b3JUeXBlc01hcCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWdpc3RlciB2YWxpZGF0b3IgdHlwZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBOYW1lLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL3ZhbGlkYXRvcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSB2YWxpZGF0b3JDbGFzcyAtIFZhbGlkYXRvciBjbGFzcy5cbiAgICovXG4gIHN0YXRpYyByZWdpc3RlclZhbGlkYXRvclR5cGUobmFtZSwgdmFsaWRhdG9yQ2xhc3MpIHtcbiAgICB0aGlzLnZhbGlkYXRvclR5cGVzKClbbmFtZV0gPSB2YWxpZGF0b3JDbGFzc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVnaXN0ZXIgbGlmZWN5Y2xlIGNhbGxiYWNrLlxuICAgKiBAcGFyYW0ge1wiYWZ0ZXJDcmVhdGVcIiB8IFwiYWZ0ZXJEZXN0cm95XCIgfCBcImFmdGVyU2F2ZVwiIHwgXCJhZnRlclVwZGF0ZVwiIHwgXCJiZWZvcmVDcmVhdGVcIiB8IFwiYmVmb3JlRGVzdHJveVwiIHwgXCJiZWZvcmVTYXZlXCIgfCBcImJlZm9yZVVwZGF0ZVwiIHwgXCJiZWZvcmVWYWxpZGF0aW9uXCJ9IGNhbGxiYWNrTmFtZSAtIENhbGxiYWNrIHR5cGUuXG4gICAqIEBwYXJhbSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlfSBjYWxsYmFjayAtIENhbGxiYWNrIGZ1bmN0aW9uIG9yIGluc3RhbmNlIG1ldGhvZCBuYW1lLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyByZWdpc3RlckxpZmVjeWNsZUNhbGxiYWNrKGNhbGxiYWNrTmFtZSwgY2FsbGJhY2spIHtcbiAgICBjb25zdCBjYWxsYmFja3MgPSB0aGlzLmdldExpZmVjeWNsZUNhbGxiYWNrc01hcCgpXG5cbiAgICBpZiAoIWNhbGxiYWNrc1tjYWxsYmFja05hbWVdKSB7XG4gICAgICBjYWxsYmFja3NbY2FsbGJhY2tOYW1lXSA9IFtdXG4gICAgfVxuXG4gICAgY2FsbGJhY2tzW2NhbGxiYWNrTmFtZV0ucHVzaChjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHVucmVnaXN0ZXIgbGlmZWN5Y2xlIGNhbGxiYWNrLlxuICAgKiBAcGFyYW0ge1wiYWZ0ZXJDcmVhdGVcIiB8IFwiYWZ0ZXJEZXN0cm95XCIgfCBcImFmdGVyU2F2ZVwiIHwgXCJhZnRlclVwZGF0ZVwiIHwgXCJiZWZvcmVDcmVhdGVcIiB8IFwiYmVmb3JlRGVzdHJveVwiIHwgXCJiZWZvcmVTYXZlXCIgfCBcImJlZm9yZVVwZGF0ZVwiIHwgXCJiZWZvcmVWYWxpZGF0aW9uXCJ9IGNhbGxiYWNrTmFtZSAtIENhbGxiYWNrIHR5cGUuXG4gICAqIEBwYXJhbSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlfSBjYWxsYmFjayAtIFByZXZpb3VzbHkgcmVnaXN0ZXJlZCBjYWxsYmFjay5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgdW5yZWdpc3RlckxpZmVjeWNsZUNhbGxiYWNrKGNhbGxiYWNrTmFtZSwgY2FsbGJhY2spIHtcbiAgICBjb25zdCBjYWxsYmFja3MgPSB0aGlzLmdldExpZmVjeWNsZUNhbGxiYWNrc01hcCgpW2NhbGxiYWNrTmFtZV1cblxuICAgIGlmICghY2FsbGJhY2tzKSByZXR1cm5cblxuICAgIGNvbnN0IGNhbGxiYWNrSW5kZXggPSBjYWxsYmFja3MuaW5kZXhPZihjYWxsYmFjaylcblxuICAgIGlmIChjYWxsYmFja0luZGV4ID49IDApIGNhbGxiYWNrcy5zcGxpY2UoY2FsbGJhY2tJbmRleCwgMSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJlZm9yZSB2YWxpZGF0aW9uLlxuICAgKiBAdGVtcGxhdGUgUlxuICAgKiBAdGhpcyB7TW9kZWxDb25zdHJ1Y3RvcjxSPn1cbiAgICogQHBhcmFtIHtMaWZlY3ljbGVDYWxsYmFja1R5cGU8Uj59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZnVuY3Rpb24gb3IgaW5zdGFuY2UgbWV0aG9kIG5hbWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIGJlZm9yZVZhbGlkYXRpb24oY2FsbGJhY2spIHtcbiAgICBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZC5yZWdpc3RlckxpZmVjeWNsZUNhbGxiYWNrLmNhbGwodGhpcywgXCJiZWZvcmVWYWxpZGF0aW9uXCIsIC8qKiBAdHlwZSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlfSAqLyAoY2FsbGJhY2spKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYmVmb3JlIHNhdmUuXG4gICAqIEB0ZW1wbGF0ZSBSXG4gICAqIEB0aGlzIHtNb2RlbENvbnN0cnVjdG9yPFI+fVxuICAgKiBAcGFyYW0ge0xpZmVjeWNsZUNhbGxiYWNrVHlwZTxSPn0gY2FsbGJhY2sgLSBDYWxsYmFjayBmdW5jdGlvbiBvciBpbnN0YW5jZSBtZXRob2QgbmFtZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgYmVmb3JlU2F2ZShjYWxsYmFjaykge1xuICAgIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkLnJlZ2lzdGVyTGlmZWN5Y2xlQ2FsbGJhY2suY2FsbCh0aGlzLCBcImJlZm9yZVNhdmVcIiwgLyoqIEB0eXBlIHtMaWZlY3ljbGVDYWxsYmFja1R5cGV9ICovIChjYWxsYmFjaykpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBiZWZvcmUgY3JlYXRlLlxuICAgKiBAdGVtcGxhdGUgUlxuICAgKiBAdGhpcyB7TW9kZWxDb25zdHJ1Y3RvcjxSPn1cbiAgICogQHBhcmFtIHtMaWZlY3ljbGVDYWxsYmFja1R5cGU8Uj59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZnVuY3Rpb24gb3IgaW5zdGFuY2UgbWV0aG9kIG5hbWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIGJlZm9yZUNyZWF0ZShjYWxsYmFjaykge1xuICAgIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkLnJlZ2lzdGVyTGlmZWN5Y2xlQ2FsbGJhY2suY2FsbCh0aGlzLCBcImJlZm9yZUNyZWF0ZVwiLCAvKiogQHR5cGUge0xpZmVjeWNsZUNhbGxiYWNrVHlwZX0gKi8gKGNhbGxiYWNrKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJlZm9yZSB1cGRhdGUuXG4gICAqIEB0ZW1wbGF0ZSBSXG4gICAqIEB0aGlzIHtNb2RlbENvbnN0cnVjdG9yPFI+fVxuICAgKiBAcGFyYW0ge0xpZmVjeWNsZUNhbGxiYWNrVHlwZTxSPn0gY2FsbGJhY2sgLSBDYWxsYmFjayBmdW5jdGlvbiBvciBpbnN0YW5jZSBtZXRob2QgbmFtZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgYmVmb3JlVXBkYXRlKGNhbGxiYWNrKSB7XG4gICAgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQucmVnaXN0ZXJMaWZlY3ljbGVDYWxsYmFjay5jYWxsKHRoaXMsIFwiYmVmb3JlVXBkYXRlXCIsIC8qKiBAdHlwZSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlfSAqLyAoY2FsbGJhY2spKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYmVmb3JlIGRlc3Ryb3kuXG4gICAqIEB0ZW1wbGF0ZSBSXG4gICAqIEB0aGlzIHtNb2RlbENvbnN0cnVjdG9yPFI+fVxuICAgKiBAcGFyYW0ge0xpZmVjeWNsZUNhbGxiYWNrVHlwZTxSPn0gY2FsbGJhY2sgLSBDYWxsYmFjayBmdW5jdGlvbiBvciBpbnN0YW5jZSBtZXRob2QgbmFtZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgYmVmb3JlRGVzdHJveShjYWxsYmFjaykge1xuICAgIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkLnJlZ2lzdGVyTGlmZWN5Y2xlQ2FsbGJhY2suY2FsbCh0aGlzLCBcImJlZm9yZURlc3Ryb3lcIiwgLyoqIEB0eXBlIHtMaWZlY3ljbGVDYWxsYmFja1R5cGV9ICovIChjYWxsYmFjaykpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZnRlciBzYXZlLlxuICAgKiBAdGVtcGxhdGUgUlxuICAgKiBAdGhpcyB7TW9kZWxDb25zdHJ1Y3RvcjxSPn1cbiAgICogQHBhcmFtIHtMaWZlY3ljbGVDYWxsYmFja1R5cGU8Uj59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZnVuY3Rpb24gb3IgaW5zdGFuY2UgbWV0aG9kIG5hbWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIGFmdGVyU2F2ZShjYWxsYmFjaykge1xuICAgIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkLnJlZ2lzdGVyTGlmZWN5Y2xlQ2FsbGJhY2suY2FsbCh0aGlzLCBcImFmdGVyU2F2ZVwiLCAvKiogQHR5cGUge0xpZmVjeWNsZUNhbGxiYWNrVHlwZX0gKi8gKGNhbGxiYWNrKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFmdGVyIGNyZWF0ZS5cbiAgICogQHRlbXBsYXRlIFJcbiAgICogQHRoaXMge01vZGVsQ29uc3RydWN0b3I8Uj59XG4gICAqIEBwYXJhbSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlPFI+fSBjYWxsYmFjayAtIENhbGxiYWNrIGZ1bmN0aW9uIG9yIGluc3RhbmNlIG1ldGhvZCBuYW1lLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBhZnRlckNyZWF0ZShjYWxsYmFjaykge1xuICAgIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkLnJlZ2lzdGVyTGlmZWN5Y2xlQ2FsbGJhY2suY2FsbCh0aGlzLCBcImFmdGVyQ3JlYXRlXCIsIC8qKiBAdHlwZSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlfSAqLyAoY2FsbGJhY2spKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWZ0ZXIgdXBkYXRlLlxuICAgKiBAdGVtcGxhdGUgUlxuICAgKiBAdGhpcyB7TW9kZWxDb25zdHJ1Y3RvcjxSPn1cbiAgICogQHBhcmFtIHtMaWZlY3ljbGVDYWxsYmFja1R5cGU8Uj59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZnVuY3Rpb24gb3IgaW5zdGFuY2UgbWV0aG9kIG5hbWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIGFmdGVyVXBkYXRlKGNhbGxiYWNrKSB7XG4gICAgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQucmVnaXN0ZXJMaWZlY3ljbGVDYWxsYmFjay5jYWxsKHRoaXMsIFwiYWZ0ZXJVcGRhdGVcIiwgLyoqIEB0eXBlIHtMaWZlY3ljbGVDYWxsYmFja1R5cGV9ICovIChjYWxsYmFjaykpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZnRlciBkZXN0cm95LlxuICAgKiBAdGVtcGxhdGUgUlxuICAgKiBAdGhpcyB7TW9kZWxDb25zdHJ1Y3RvcjxSPn1cbiAgICogQHBhcmFtIHtMaWZlY3ljbGVDYWxsYmFja1R5cGU8Uj59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZnVuY3Rpb24gb3IgaW5zdGFuY2UgbWV0aG9kIG5hbWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIGFmdGVyRGVzdHJveShjYWxsYmFjaykge1xuICAgIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkLnJlZ2lzdGVyTGlmZWN5Y2xlQ2FsbGJhY2suY2FsbCh0aGlzLCBcImFmdGVyRGVzdHJveVwiLCAvKiogQHR5cGUge0xpZmVjeWNsZUNhbGxiYWNrVHlwZX0gKi8gKGNhbGxiYWNrKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBFbmFibGVzIGF1dG9tYXRpYyBjcmVhdGUvdXBkYXRlL2Rlc3Ryb3kgYXVkaXRpbmcgZm9yIHRoaXMgbW9kZWwuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIGF1ZGl0ZWQoKSB7XG4gICAgcmVnaXN0ZXJBdWRpdGluZyh0aGlzKVxuICB9XG5cbiAgLyoqXG4gICAqIERlY2xhcmVzIGFuIGFhc20tc3R5bGUgc3RhdGUgbWFjaGluZSBvbiB0aGlzIG1vZGVsOiBuYW1lZCBzdGF0ZXMsIGV2ZW50c1xuICAgKiAoZ3VhcmRlZCB0cmFuc2l0aW9ucyksIGFuZCBlbnRlci9leGl0ICsgYmVmb3JlL2FmdGVyIHRyYW5zaXRpb24gaG9va3MuIFNlZVxuICAgKiBgc3RhdGUtbWFjaGluZS5qc2AuIEdlbmVyYXRlcyBgZXZlbnQoKWAgLyBgZXZlbnRBbmRTYXZlKClgIC8gYGNhbkV2ZW50KClgXG4gICAqIHRyYW5zaXRpb24gbWV0aG9kcyBwZXIgZGVjbGFyZWQgZXZlbnQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9zdGF0ZS1tYWNoaW5lLmpzXCIpLlN0YXRlTWFjaGluZURlZmluaXRpb259IGRlZmluaXRpb24gLSBTdGF0ZSBtYWNoaW5lIGRlZmluaXRpb24uXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIHN0YXRlTWFjaGluZShkZWZpbml0aW9uKSB7XG4gICAgc3RhdGVNYWNoaW5lKHRoaXMsIGRlZmluaXRpb24pXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGlzIG1vZGVsJ3Mgc3RhdGUgbWFjaGluZSBkZWZpbml0aW9uLCBvciBudWxsIHdoZW4gaXQgZGVjbGFyZXMgbm9uZS5cbiAgICogYE1vZGVsLnN0YXRlTWFjaGluZSguLi4pYCBvdmVycmlkZXMgdGhpcyBvbiBjbGFzc2VzIHRoYXQgZGVjbGFyZSBhIG1hY2hpbmUuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3N0YXRlLW1hY2hpbmUuanNcIikuU3RhdGVNYWNoaW5lRGVmaW5pdGlvbiB8IG51bGx9IC0gVGhlIHN0YXRlIG1hY2hpbmUgZGVmaW5pdGlvbiwgb3IgbnVsbCB3aGVuIG5vbmUgaXMgZGVjbGFyZWQuXG4gICAqL1xuICBzdGF0aWMgZ2V0U3RhdGVNYWNoaW5lRGVmaW5pdGlvbigpIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhpcyBtb2RlbCdzIHN0YXRlIGNvbHVtbiwgb3IgbnVsbCB3aGVuIGl0IGRlY2xhcmVzIG5vIHN0YXRlIG1hY2hpbmUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSAtIFRoZSBzdGF0ZSBjb2x1bW4gbmFtZSwgb3IgbnVsbCB3aGVuIG5vIHN0YXRlIG1hY2hpbmUgaXMgZGVjbGFyZWQuXG4gICAqL1xuICBzdGF0aWMgZ2V0U3RhdGVNYWNoaW5lQ29sdW1uKCkge1xuICAgIHJldHVybiBudWxsXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGlzIG1vZGVsJ3MgZGVjbGFyZWQgc3RhdGUgbmFtZXMgKGVtcHR5IHdoZW4gaXQgaGFzIG5vIHN0YXRlIG1hY2hpbmUpLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nW119IC0gVGhlIGRlY2xhcmVkIHN0YXRlIG5hbWVzLCBvciBhbiBlbXB0eSBhcnJheSB3aGVuIG5vIHN0YXRlIG1hY2hpbmUgaXMgZGVjbGFyZWQuXG4gICAqL1xuICBzdGF0aWMgZ2V0U3RhdGVNYWNoaW5lU3RhdGVOYW1lcygpIHtcbiAgICByZXR1cm4gW11cbiAgfVxuXG4gIC8qKlxuICAgKiBNYWludGFpbnMgYSBjb3VudGVyIGNvbHVtbiBvbiBhIGBiZWxvbmdzVG9gIHBhcmVudCBhcyB0aGUgc3VtIG9mIGEgcGVyLXJlY29yZFxuICAgKiBtYWduaXR1ZGUsIGtlcHQgY3VycmVudCBieSBhdG9taWMgaW5jcmVtZW50cyBkaWZmZWQgb24gZXZlcnkgY3JlYXRlL3VwZGF0ZS9cbiAgICogZGVzdHJveSAoYW5kIG1vdmVkIGJldHdlZW4gcGFyZW50cyB3aGVuIHRoZSBmb3JlaWduIGtleSBjaGFuZ2VzKS4gU2VlXG4gICAqIGBjb3VudGVyLWNhY2hlLW1hZ25pdHVkZS5qc2AuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9jb3VudGVyLWNhY2hlLW1hZ25pdHVkZS5qc1wiKS5NYWduaXR1ZGVDb3VudGVyQ2FjaGVEZWZpbml0aW9ufSBkZWZpbml0aW9uIC0gQ291bnRlciBjYWNoZSBkZWZpbml0aW9uLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBtYWduaXR1ZGVDb3VudGVyQ2FjaGUoZGVmaW5pdGlvbikge1xuICAgIHJlZ2lzdGVyTWFnbml0dWRlQ291bnRlckNhY2hlKHRoaXMsIGRlZmluaXRpb24pXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGEgY2FsbGJhY2sgaW52b2tlZCBhZnRlciB0aGlzIG1vZGVsIHdyaXRlcyBhbiBhdWRpdCByb3cgZm9yIHRoZSBhY3Rpb24uXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhY3Rpb24gLSBBdWRpdCBhY3Rpb24gbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2F1ZGl0aW5nLmpzXCIpLkF1ZGl0Q2FsbGJhY2t9IGNhbGxiYWNrIC0gQ2FsbGJhY2sgdG8gcnVuIGFmdGVyIGF1ZGl0IGNyZWF0aW9uLlxuICAgKiBAcmV0dXJucyB7KCkgPT4gdm9pZH0gVW5zdWJzY3JpYmUgZnVuY3Rpb24uXG4gICAqL1xuICBzdGF0aWMgb25BdWRpdChhY3Rpb24sIGNhbGxiYWNrKSB7XG4gICAgcmV0dXJuIHJlZ2lzdGVyQXVkaXRDYWxsYmFjayh0aGlzLCBhY3Rpb24sIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgcmVjb3JkcyB0aGF0IGRvIG5vdCBoYXZlIGFuIGF1ZGl0IHJvdyBmb3IgdGhlIGdpdmVuIGFjdGlvbi5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFjdGlvbiAtIEF1ZGl0IGFjdGlvbiBuYW1lLlxuICAgKiBAcmV0dXJucyB7TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gUXVlcnkgc2NvcGVkIHRvIHJlY29yZHMgd2l0aG91dCB0aGF0IGF1ZGl0IGFjdGlvbi5cbiAgICovXG4gIHN0YXRpYyB3aXRob3V0QXVkaXQoYWN0aW9uKSB7XG4gICAgcmV0dXJuIHdpdGhvdXRBdWRpdCh0aGlzLCBhY3Rpb24pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdmFsaWRhdG9yIHR5cGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB2YWxpZGF0b3JOYW1lIC0gVmFsaWRhdG9yIG5hbWUuXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgaW1wb3J0KFwiLi92YWxpZGF0b3JzL2Jhc2UuanNcIikuZGVmYXVsdH0gLSBUaGUgdmFsaWRhdG9yIHR5cGUuXG4gICAqL1xuICBzdGF0aWMgZ2V0VmFsaWRhdG9yVHlwZSh2YWxpZGF0b3JOYW1lKSB7XG4gICAgaWYgKCEodmFsaWRhdG9yTmFtZSBpbiB0aGlzLnZhbGlkYXRvclR5cGVzKCkpKSB0aHJvdyBuZXcgRXJyb3IoYFZhbGlkYXRvciB0eXBlICR7dmFsaWRhdG9yTmFtZX0gbm90IGZvdW5kYClcblxuICAgIHJldHVybiB0aGlzLnZhbGlkYXRvclR5cGVzKClbdmFsaWRhdG9yTmFtZV1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbGF0aW9uc2hpcCBleGlzdHMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgcmVsYXRpb25zaGlwIGV4aXN0cy5cbiAgICovXG4gIHN0YXRpYyBfcmVsYXRpb25zaGlwRXhpc3RzKHJlbGF0aW9uc2hpcE5hbWUpIHtcbiAgICBpZiAocmVsYXRpb25zaGlwTmFtZSBpbiB0aGlzLmdldFJlbGF0aW9uc2hpcHNNYXAoKSkge1xuICAgICAgcmV0dXJuIHRydWVcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWxhdGlvbnNoaXBTY29wZUNhbGxiYWNrIHR5cGUuXG4gICAqIEB0eXBlZGVmIHsocXVlcnk6IGltcG9ydChcIi4uL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkPikgPT4gKGltcG9ydChcIi4uL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkPiB8IHZvaWQpfSBSZWxhdGlvbnNoaXBTY29wZUNhbGxiYWNrXG4gICAqL1xuICAvKipcbiAgICogUmVsYXRpb25zaGlwRGF0YUFyZ3VtZW50VHlwZSB0eXBlLlxuICAgKiBAdHlwZWRlZiB7b2JqZWN0fSBSZWxhdGlvbnNoaXBEYXRhQXJndW1lbnRUeXBlXG4gICAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gW2F1dG9sb2FkXSAtIERpc2FibGUgYXV0by1iYXRjaC1wcmVsb2FkIGZvciB0aGlzIHJlbGF0aW9uc2hpcCBieSBwYXNzaW5nIGZhbHNlLiBEZWZhdWx0IHRydWUuXG4gICAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbY2xhc3NOYW1lXSAtIE1vZGVsIGNsYXNzIG5hbWUgZm9yIHRoZSByZWxhdGVkIHJlY29yZC5cbiAgICogQHByb3BlcnR5IHtzdHJpbmd9IFtkZXBlbmRlbnRdIC0gRGVwZW5kZW50IGFjdGlvbiB3aGVuIHBhcmVudCBpcyBkZXN0cm95ZWQgKGUuZy4gXCJkZXN0cm95XCIpLlxuICAgKiBAcHJvcGVydHkge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gW2tsYXNzXSAtIE1vZGVsIGNsYXNzIGZvciB0aGUgcmVsYXRlZCByZWNvcmQuXG4gICAqIEBwcm9wZXJ0eSB7UmVsYXRpb25zaGlwU2NvcGVDYWxsYmFja30gW3Njb3BlXSAtIE9wdGlvbmFsIHNjb3BlIGNhbGxiYWNrIGZvciB0aGUgcmVsYXRpb25zaGlwLlxuICAgKiBAcHJvcGVydHkge3N0cmluZ30gW3R5cGVdIC0gUmVsYXRpb25zaGlwIHR5cGUgKGUuZy4gXCJoYXNNYW55XCIsIFwiYmVsb25nc1RvXCIpLlxuICAgKi9cbiAgLyoqXG4gICAqIFJ1bnMgZGVmaW5lIHJlbGF0aW9uc2hpcC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHBhcmFtIHtSZWxhdGlvbnNoaXBEYXRhQXJndW1lbnRUeXBlfSBkYXRhIC0gRGF0YSBwYXlsb2FkLlxuICAgKi9cbiAgc3RhdGljIF9kZWZpbmVSZWxhdGlvbnNoaXAocmVsYXRpb25zaGlwTmFtZSwgZGF0YSkge1xuICAgIGlmICghcmVsYXRpb25zaGlwTmFtZSkgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHJlbGF0aW9uc2hpcCBuYW1lIGdpdmVuOiAke3JlbGF0aW9uc2hpcE5hbWV9YClcbiAgICBpZiAodGhpcy5fcmVsYXRpb25zaGlwRXhpc3RzKHJlbGF0aW9uc2hpcE5hbWUpKSB0aHJvdyBuZXcgRXJyb3IoYFJlbGF0aW9uc2hpcCAke3JlbGF0aW9uc2hpcE5hbWV9IGFscmVhZHkgZXhpc3RzYClcblxuICAgIGNvbnN0IGFjdHVhbERhdGEgPSBPYmplY3QuYXNzaWduKFxuICAgICAge1xuICAgICAgICBtb2RlbENsYXNzOiB0aGlzLFxuICAgICAgICByZWxhdGlvbnNoaXBOYW1lLFxuICAgICAgICB0eXBlOiBcImhhc01hbnlcIlxuICAgICAgfSxcbiAgICAgIGRhdGFcbiAgICApXG5cbiAgICBpZiAoIWFjdHVhbERhdGEuY2xhc3NOYW1lICYmICFhY3R1YWxEYXRhLmtsYXNzKSB7XG4gICAgICBhY3R1YWxEYXRhLmNsYXNzTmFtZSA9IHNpbmd1bGFyaXplTW9kZWxOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgfVxuXG4gICAgbGV0IHJlbGF0aW9uc2hpcFxuICAgIGNvbnN0IHByb3RvdHlwZSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMucHJvdG90eXBlKSlcblxuICAgIGlmIChhY3R1YWxEYXRhLnR5cGUgPT0gXCJiZWxvbmdzVG9cIikge1xuICAgICAgcmVsYXRpb25zaGlwID0gbmV3IEJlbG9uZ3NUb1JlbGF0aW9uc2hpcChhY3R1YWxEYXRhKVxuXG4gICAgICBwcm90b3R5cGVbcmVsYXRpb25zaGlwTmFtZV0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgY29uc3QgcmVsYXRpb25zaGlwID0gdGhpcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcblxuICAgICAgICByZXR1cm4gcmVsYXRpb25zaGlwLmxvYWRlZCgpXG4gICAgICB9XG5cbiAgICAgIHByb3RvdHlwZVtgYnVpbGQke2luZmxlY3Rpb24uY2FtZWxpemUocmVsYXRpb25zaGlwTmFtZSl9YF0gPSBmdW5jdGlvbigvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gYXR0cmlidXRlcykge1xuICAgICAgICByZXR1cm4gYnVpbGRSZWxhdGVkUmVjb3JkV2l0aEludmVyc2UoLyoqIEB0eXBlIHtWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gKi8gKHRoaXMpLCByZWxhdGlvbnNoaXBOYW1lLCBhdHRyaWJ1dGVzLCB0cnVlKVxuICAgICAgfVxuXG4gICAgICBwcm90b3R5cGVbYGxvYWQke2luZmxlY3Rpb24uY2FtZWxpemUocmVsYXRpb25zaGlwTmFtZSl9YF0gPSBhc3luYyBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMubG9hZFJlbGF0aW9uc2hpcChyZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgfVxuXG4gICAgICBwcm90b3R5cGVbYCR7cmVsYXRpb25zaGlwTmFtZX1PckxvYWRgXSA9IGFzeW5jIGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5yZWxhdGlvbnNoaXBPckxvYWQocmVsYXRpb25zaGlwTmFtZSlcbiAgICAgIH1cblxuICAgICAgcHJvdG90eXBlW2BzZXQke2luZmxlY3Rpb24uY2FtZWxpemUocmVsYXRpb25zaGlwTmFtZSl9YF0gPSBmdW5jdGlvbigvKiogQHR5cGUge1ZlbG9jaW91c0RhdGFiYXNlUmVjb3JkIHwgbnVsbCB8IHVuZGVmaW5lZH0gKi8gbW9kZWwpIHtcbiAgICAgICAgY29uc3QgcmVsYXRpb25zaGlwID0gdGhpcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcbiAgICAgICAgY29uc3QgZm9yZWlnbktleVZhbHVlID0gdGhpcy5fYmVsb25nc1RvRm9yZWlnbktleVZhbHVlKHttb2RlbCwgcmVsYXRpb25zaGlwfSlcblxuICAgICAgICByZWxhdGlvbnNoaXAuc2V0TG9hZGVkKG1vZGVsIHx8IHVuZGVmaW5lZClcbiAgICAgICAgcmVsYXRpb25zaGlwLnNldFByZWxvYWRlZCh0cnVlKVxuICAgICAgICByZWxhdGlvbnNoaXAuc2V0RGlydHkodHJ1ZSlcbiAgICAgICAgdGhpcy5fc2V0Q29sdW1uQXR0cmlidXRlKHJlbGF0aW9uc2hpcC5nZXRGb3JlaWduS2V5KCksIGZvcmVpZ25LZXlWYWx1ZSlcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGFjdHVhbERhdGEudHlwZSA9PSBcImhhc01hbnlcIikge1xuICAgICAgcmVsYXRpb25zaGlwID0gbmV3IEhhc01hbnlSZWxhdGlvbnNoaXAoYWN0dWFsRGF0YSlcblxuICAgICAgcHJvdG90eXBlW3JlbGF0aW9uc2hpcE5hbWVdID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiAvKiogQHR5cGUge2ltcG9ydChcIi4vaW5zdGFuY2UtcmVsYXRpb25zaGlwcy9oYXMtbWFueS5qc1wiKS5kZWZhdWx0PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+LCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICh0aGlzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKSlcbiAgICAgIH1cblxuICAgICAgcHJvdG90eXBlW2Ake3JlbGF0aW9uc2hpcE5hbWV9TG9hZGVkYF0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpLmxvYWRlZCgpXG4gICAgICB9XG5cbiAgICAgIHByb3RvdHlwZVtgbG9hZCR7aW5mbGVjdGlvbi5jYW1lbGl6ZShyZWxhdGlvbnNoaXBOYW1lKX1gXSA9IGFzeW5jIGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5sb2FkUmVsYXRpb25zaGlwKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICB9XG5cbiAgICAgIHByb3RvdHlwZVtgJHtyZWxhdGlvbnNoaXBOYW1lfU9yTG9hZGBdID0gYXN5bmMgZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLnJlbGF0aW9uc2hpcE9yTG9hZChyZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoYWN0dWFsRGF0YS50eXBlID09IFwiaGFzT25lXCIpIHtcbiAgICAgIHJlbGF0aW9uc2hpcCA9IG5ldyBIYXNPbmVSZWxhdGlvbnNoaXAoYWN0dWFsRGF0YSlcblxuICAgICAgcHJvdG90eXBlW3JlbGF0aW9uc2hpcE5hbWVdID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKS5sb2FkZWQoKVxuICAgICAgfVxuXG4gICAgICBwcm90b3R5cGVbYGJ1aWxkJHtpbmZsZWN0aW9uLmNhbWVsaXplKHJlbGF0aW9uc2hpcE5hbWUpfWBdID0gZnVuY3Rpb24oLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIGF0dHJpYnV0ZXMpIHtcbiAgICAgICAgcmV0dXJuIGJ1aWxkUmVsYXRlZFJlY29yZFdpdGhJbnZlcnNlKC8qKiBAdHlwZSB7VmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9ICovICh0aGlzKSwgcmVsYXRpb25zaGlwTmFtZSwgYXR0cmlidXRlcywgZmFsc2UpXG4gICAgICB9XG5cbiAgICAgIHByb3RvdHlwZVtgbG9hZCR7aW5mbGVjdGlvbi5jYW1lbGl6ZShyZWxhdGlvbnNoaXBOYW1lKX1gXSA9IGFzeW5jIGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5sb2FkUmVsYXRpb25zaGlwKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICB9XG5cbiAgICAgIHByb3RvdHlwZVtgJHtyZWxhdGlvbnNoaXBOYW1lfU9yTG9hZGBdID0gYXN5bmMgZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLnJlbGF0aW9uc2hpcE9yTG9hZChyZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gcmVsYXRpb25zaGlwIHR5cGU6ICR7YWN0dWFsRGF0YS50eXBlfWApXG4gICAgfVxuXG4gICAgdGhpcy5nZXRSZWxhdGlvbnNoaXBzTWFwKClbcmVsYXRpb25zaGlwTmFtZV0gPSByZWxhdGlvbnNoaXBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSByZWxhdGlvbnNoaXAgYXJncy5cbiAgICogQHBhcmFtIHtSZWxhdGlvbnNoaXBTY29wZUNhbGxiYWNrIHwgb2JqZWN0IHwgdW5kZWZpbmVkfSBzY29wZU9yT3B0aW9ucyAtIFNjb3BlIGNhbGxiYWNrIG9yIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7b2JqZWN0IHwgdW5kZWZpbmVkfSBvcHRpb25zIC0gT3B0aW9ucy5cbiAgICogQHJldHVybnMge3tzY29wZTogKFJlbGF0aW9uc2hpcFNjb3BlQ2FsbGJhY2sgfCB1bmRlZmluZWQpLCByZWxhdGlvbnNoaXBPcHRpb25zOiBvYmplY3R9fSAtIE5vcm1hbGl6ZWQgYXJndW1lbnRzLlxuICAgKi9cbiAgc3RhdGljIF9ub3JtYWxpemVSZWxhdGlvbnNoaXBBcmdzKHNjb3BlT3JPcHRpb25zLCBvcHRpb25zKSB7XG4gICAgaWYgKHR5cGVvZiBzY29wZU9yT3B0aW9ucyA9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHNjb3BlOiAvKiogQHR5cGUge1JlbGF0aW9uc2hpcFNjb3BlQ2FsbGJhY2t9ICovIChzY29wZU9yT3B0aW9ucyksXG4gICAgICAgIHJlbGF0aW9uc2hpcE9wdGlvbnM6IG9wdGlvbnMgfHwge31cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgc2NvcGU6IHVuZGVmaW5lZCxcbiAgICAgIHJlbGF0aW9uc2hpcE9wdGlvbnM6IHNjb3BlT3JPcHRpb25zIHx8IHt9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhZnRlckNyZWF0ZSwgYWZ0ZXJTYXZlLCBhbmQgYWZ0ZXJEZXN0cm95IGNhbGxiYWNrcyB0byBzeW5jXG4gICAqIGEgY291bnRlciBjYWNoZSBjb2x1bW4gb24gdGhlIHBhcmVudCBtb2RlbC4gVGhlIGNvbHVtbiBuYW1lIGZvbGxvd3NcbiAgICogdGhlIGNvbnZlbnRpb24gYDxjaGlsZE1vZGVsUGx1cmFsQ2FtZWxDYXNlPkNvdW50YC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBUaGUgYmVsb25nc1RvIHJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKi9cbiAgc3RhdGljIF9yZWdpc3RlckNvdW50ZXJDYWNoZUNhbGxiYWNrcyhyZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgY29uc3QgQ2hpbGRNb2RlbCA9IHRoaXNcblxuICAgIC8qKlxuICAgICAqIEF0b21pY2FsbHkgcmVjb21wdXRlcyB0aGUgY291bnRlciBjYWNoZSBjb2x1bW4gb24gdGhlIHBhcmVudCB2aWEgYVxuICAgICAqIHNpbmdsZSBVUERBVEUgLi4uIFNFVCBjb2wgPSAoU0VMRUNUIENPVU5UKCopKSBzbyBjb25jdXJyZW50XG4gICAgICogY3JlYXRlcy9kZXN0cm95cyBjYW5ub3QgcmFjZSBpbnRvIGEgc3RhbGUgY291bnQuXG4gICAgICogQHBhcmFtIHtudW1iZXIgfCBzdHJpbmcgfCBudWxsfSBwYXJlbnRJZCAtIFBhcmVudCBwcmltYXJ5LWtleSB2YWx1ZS5cbiAgICAgKiBAcGFyYW0ge1ZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSByZWNvcmQgLSBDaGlsZCByZWNvcmQgb3duaW5nIHRoZSBjb25uZWN0aW9uLlxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIGNvdW50ZXIgY2FjaGUgaGFzIGJlZW4gc3luY2VkLlxuICAgICAqL1xuICAgIGFzeW5jIGZ1bmN0aW9uIHN5bmNDb3VudGVyKHBhcmVudElkLCByZWNvcmQpIHtcbiAgICAgIGlmICghcGFyZW50SWQpIHJldHVyblxuXG4gICAgICBjb25zdCByZWxhdGlvbnNoaXAgPSBDaGlsZE1vZGVsLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgY29uc3QgUGFyZW50TW9kZWwgPSByZWxhdGlvbnNoaXAuZ2V0VGFyZ2V0TW9kZWxDbGFzcygpXG5cbiAgICAgIGlmICghUGFyZW50TW9kZWwpIHJldHVyblxuXG4gICAgICBjb25zdCBwcmltYXJ5S2V5ID0gcmVsYXRpb25zaGlwLmdldFByaW1hcnlLZXkoKVxuICAgICAgY29uc3QgZmsgPSByZWxhdGlvbnNoaXAuZ2V0Rm9yZWlnbktleSgpXG4gICAgICBjb25zdCBjaGlsZE1vZGVsTmFtZSA9IENoaWxkTW9kZWwuZ2V0TW9kZWxOYW1lKClcbiAgICAgIGNvbnN0IGNvdW50ZXJDb2x1bW4gPSBpbmZsZWN0aW9uLnVuZGVyc2NvcmUoYCR7aW5mbGVjdGlvbi5wbHVyYWxpemUoY2hpbGRNb2RlbE5hbWUpfUNvdW50YClcbiAgICAgIGNvbnN0IHBhcmVudFRhYmxlID0gUGFyZW50TW9kZWwudGFibGVOYW1lKClcbiAgICAgIGNvbnN0IGNoaWxkVGFibGUgPSBDaGlsZE1vZGVsLnRhYmxlTmFtZSgpXG4gICAgICBjb25zdCBwa0NvbHVtbiA9IGluZmxlY3Rpb24udW5kZXJzY29yZShwcmltYXJ5S2V5KVxuICAgICAgY29uc3QgY29ubmVjdGlvbiA9IHJlY29yZFxuICAgICAgICAucXVlcnlGb3JNb2RlbChQYXJlbnRNb2RlbClcbiAgICAgICAgLmRyaXZlclxuICAgICAgY29uc3QgcXVvdGVkID0gY29ubmVjdGlvbi5xdW90ZShwYXJlbnRJZClcblxuICAgICAgY29uc3Qgc3FsID0gYFVQREFURSAke2Nvbm5lY3Rpb24ucXVvdGVUYWJsZShwYXJlbnRUYWJsZSl9IFNFVCAke2Nvbm5lY3Rpb24ucXVvdGVDb2x1bW4oY291bnRlckNvbHVtbil9ID0gKFNFTEVDVCBDT1VOVCgqKSBGUk9NICR7Y29ubmVjdGlvbi5xdW90ZVRhYmxlKGNoaWxkVGFibGUpfSBXSEVSRSAke2Nvbm5lY3Rpb24ucXVvdGVDb2x1bW4oZmspfSA9ICR7cXVvdGVkfSkgV0hFUkUgJHtjb25uZWN0aW9uLnF1b3RlQ29sdW1uKHBrQ29sdW1uKX0gPSAke3F1b3RlZH1gXG5cbiAgICAgIGF3YWl0IGNvbm5lY3Rpb24ucXVlcnkoc3FsLCB7bG9nTmFtZTogYCR7UGFyZW50TW9kZWwubmFtZX0gVXBkYXRlYH0pXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogUnVucyByZWFkIGZrIGF0dHJpYnV0ZS5cbiAgICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSByZWNvcmQgLSBDaGlsZCByZWNvcmQgaW5zdGFuY2UuXG4gICAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIEN1cnJlbnQgZm9yZWlnbi1rZXkgYXR0cmlidXRlIHZhbHVlLlxuICAgICAqL1xuICAgIGZ1bmN0aW9uIHJlYWRGa0F0dHJpYnV0ZShyZWNvcmQpIHtcbiAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IENoaWxkTW9kZWwuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICBjb25zdCBma0F0dHJpYnV0ZSA9IGluZmxlY3Rpb24uY2FtZWxpemUocmVsYXRpb25zaGlwLmdldEZvcmVpZ25LZXkoKS5yZXBsYWNlKC9faWQkLywgXCJJZFwiKSwgdHJ1ZSlcblxuICAgICAgcmV0dXJuIHJlY29yZC5yZWFkQXR0cmlidXRlKGZrQXR0cmlidXRlKVxuICAgIH1cblxuICAgIENoaWxkTW9kZWwuYWZ0ZXJDcmVhdGUoYXN5bmMgKHJlY29yZCkgPT4ge1xuICAgICAgYXdhaXQgc3luY0NvdW50ZXIocmVhZEZrQXR0cmlidXRlKHJlY29yZCksIHJlY29yZClcbiAgICB9KVxuXG4gICAgQ2hpbGRNb2RlbC5hZnRlckRlc3Ryb3koYXN5bmMgKHJlY29yZCkgPT4ge1xuICAgICAgYXdhaXQgc3luY0NvdW50ZXIocmVhZEZrQXR0cmlidXRlKHJlY29yZCksIHJlY29yZClcbiAgICB9KVxuXG4gICAgQ2hpbGRNb2RlbC5iZWZvcmVTYXZlKGFzeW5jIChyZWNvcmQpID0+IHtcbiAgICAgIGNvbnN0IG1vZGVsID0gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHJlY29yZClcblxuICAgICAgaWYgKG1vZGVsLmlzTmV3UmVjb3JkKCkpIHJldHVyblxuXG4gICAgICBjb25zdCByZWxhdGlvbnNoaXAgPSBDaGlsZE1vZGVsLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgY29uc3QgZmtDb2x1bW4gPSByZWxhdGlvbnNoaXAuZ2V0Rm9yZWlnbktleSgpXG5cbiAgICAgIC8vIERldGVjdCBGSyBjaGFuZ2UgdmlhIGRpcmVjdCBhdHRyaWJ1dGUgYXNzaWdubWVudCBvciByZWxhdGlvbnNoaXAgc2V0dGVyLlxuICAgICAgY29uc3QgZGlyZWN0Q2hhbmdlID0gZmtDb2x1bW4gaW4gbW9kZWwuX2NoYW5nZXNcbiAgICAgIGNvbnN0IGJlbG9uZ3NUb0NoYW5nZSA9IG1vZGVsLl9pbnN0YW5jZVJlbGF0aW9uc2hpcHM/LltyZWxhdGlvbnNoaXBOYW1lXT8uZ2V0RGlydHk/LigpXG5cbiAgICAgIGlmIChkaXJlY3RDaGFuZ2UgfHwgYmVsb25nc1RvQ2hhbmdlKSB7XG4gICAgICAgIG1vZGVsW2BfY291bnRlckNhY2hlUHJldl8ke3JlbGF0aW9uc2hpcE5hbWV9YF0gPSBtb2RlbC5fYXR0cmlidXRlc1tma0NvbHVtbl1cbiAgICAgIH1cbiAgICB9KVxuXG4gICAgQ2hpbGRNb2RlbC5hZnRlclNhdmUoYXN5bmMgKHJlY29yZCkgPT4ge1xuICAgICAgY29uc3QgbW9kZWwgPSAvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAocmVjb3JkKVxuICAgICAgY29uc3QgcHJldktleSA9IGBfY291bnRlckNhY2hlUHJldl8ke3JlbGF0aW9uc2hpcE5hbWV9YFxuICAgICAgY29uc3QgcHJldmlvdXNQYXJlbnRJZCA9IG1vZGVsW3ByZXZLZXldXG5cbiAgICAgIGlmIChwcmV2aW91c1BhcmVudElkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgZGVsZXRlIG1vZGVsW3ByZXZLZXldXG4gICAgICAgIGF3YWl0IHN5bmNDb3VudGVyKHByZXZpb3VzUGFyZW50SWQsIHJlY29yZClcbiAgICAgICAgYXdhaXQgc3luY0NvdW50ZXIocmVhZEZrQXR0cmlidXRlKG1vZGVsKSwgcmVjb3JkKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcmVsYXRpb25zaGlwIGJ5IG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuL3JlbGF0aW9uc2hpcHMvYmFzZS5qc1wiKS5kZWZhdWx0fSAtIFRoZSByZWxhdGlvbnNoaXAgYnkgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBnZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSkge1xuICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IHRoaXMuZ2V0UmVsYXRpb25zaGlwc01hcCgpW3JlbGF0aW9uc2hpcE5hbWVdXG5cbiAgICBpZiAoIXJlbGF0aW9uc2hpcCkgdGhyb3cgbmV3IEVycm9yKGBObyByZWxhdGlvbnNoaXAgaW4gJHt0aGlzLm5hbWV9IGNhbGxlZCBcIiR7cmVsYXRpb25zaGlwTmFtZX1cIiBpbiBsaXN0OiAke09iamVjdC5rZXlzKHRoaXMuZ2V0UmVsYXRpb25zaGlwc01hcCgpKS5qb2luKFwiLCBcIil9YClcblxuICAgIHJldHVybiByZWxhdGlvbnNoaXBcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCByZWxhdGlvbnNoaXBzLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8aW1wb3J0KFwiLi9yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdD59IC0gVGhlIHJlbGF0aW9uc2hpcHMuXG4gICAqL1xuICBzdGF0aWMgZ2V0UmVsYXRpb25zaGlwcygpIHtcbiAgICByZXR1cm4gT2JqZWN0LnZhbHVlcyh0aGlzLmdldFJlbGF0aW9uc2hpcHNNYXAoKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCByZWxhdGlvbnNoaXBzIG1hcC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vcmVsYXRpb25zaGlwcy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAtIFJlbGF0aW9uc2hpcCBkZWZpbml0aW9ucyBrZXllZCBieSBuYW1lLlxuICAgKi9cbiAgc3RhdGljIGdldFJlbGF0aW9uc2hpcHNNYXAoKSB7XG4gICAgaWYgKCFPYmplY3QuaGFzT3duKHRoaXMsIFwiX3JlbGF0aW9uc2hpcHNcIikgfHwgIXRoaXMuX3JlbGF0aW9uc2hpcHMpIHtcbiAgICAgIC8qKlxuICAgICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vcmVsYXRpb25zaGlwcy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICAgICAgdGhpcy5fcmVsYXRpb25zaGlwcyA9IHt9XG4gICAgfVxuXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi9yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdD59ICovICh0aGlzLl9yZWxhdGlvbnNoaXBzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHJlbGF0aW9uc2hpcCBuYW1lcy5cbiAgICogQHJldHVybnMge0FycmF5PHN0cmluZz59IC0gVGhlIHJlbGF0aW9uc2hpcCBuYW1lcy5cbiAgICovXG4gIHN0YXRpYyBnZXRSZWxhdGlvbnNoaXBOYW1lcygpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRSZWxhdGlvbnNoaXBzKCkubWFwKChyZWxhdGlvbnNoaXApID0+IHJlbGF0aW9uc2hpcC5nZXRSZWxhdGlvbnNoaXBOYW1lKCkpXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXIgYSBjb25zdW1lci1kZWZpbmVkIHF1ZXJ5RGF0YSBlbnRyeS4gVGhlIGNhbGxiYWNrIHJlY2VpdmVzXG4gICAqIGEgZ3JvdXBlZCBxdWVyeSBhbHJlYWR5IGpvaW5lZCBkb3duIHRoZSByZWxhdGlvbnNoaXAgY2hhaW4gZnJvbSB0aGVcbiAgICogcm9vdCBvZiBgLnF1ZXJ5RGF0YSguLi4pYCB0byB0aGlzIG1vZGVsLCBhbHJlYWR5IGZpbHRlcmVkIGJ5IHRoZVxuICAgKiByb290IHBhcmVudCBJRHMsIGFuZCB3aXRoIGBwYXJlbnRfaWRgIHByZS1zZWxlY3RlZCDigJQgc28gdGhlIGZuXG4gICAqIG9ubHkgbmVlZHMgdG8gYWRkIGl0cyBvd24gU0VMRUNUIChhbmQgb3B0aW9uYWxseSBqb2lucy93aGVyZSkuIEFueVxuICAgKiBhbGlhc2VzIHRoZSBmbiBzZWxlY3RzIGFyZSBhdHRhY2hlZCB0byBlYWNoICoqcm9vdCoqIHJlY29yZCB2aWFcbiAgICogYHJlY29yZC5xdWVyeURhdGEoYWxpYXNOYW1lKWAuIE11bHRpLWNvbHVtbiBzZWxlY3RzIGFyZSBmaW5lIOKAlCBvbmVcbiAgICogYWxpYXMgbWFwcyB0byBvbmUgcXVlcnlEYXRhIGtleS5cbiAgICpcbiAgICogKipRdW90ZSBBUyBhbGlhc2VzIG9uIFBvc3RncmVTUUwuKiogUG9zdGdyZVNRTCBmb2xkcyB1bnF1b3RlZFxuICAgKiBpZGVudGlmaWVycyAoaW5jbHVkaW5nIFNFTEVDVCBhbGlhc2VzKSB0byBsb3dlcmNhc2UsIHNvIGFcbiAgICogYC4uLiBBUyBtYW51YWxUYXNrc0NvdW50YCBsYW5kcyBpbiB0aGUgcmVzdWx0IHJvdyBhc1xuICAgKiBgbWFudWFsdGFza3Njb3VudGAgd2hpbGUgdGhlIGxvb2t1cCBgcmVjb3JkLnF1ZXJ5RGF0YShcIm1hbnVhbFRhc2tzQ291bnRcIilgXG4gICAqIG5ldmVyIGZpbmRzIGl0LiBVc2UgYGRyaXZlci5xdW90ZUNvbHVtbihcIm1hbnVhbFRhc2tzQ291bnRcIilgIGZvciB0aGVcbiAgICogYWxpYXMgdG8gcHJlc2VydmUgdGhlIGNhc2Ugb24gZXZlcnkgc3VwcG9ydGVkIGRyaXZlcjpcbiAgICogICBxdWVyeS5zZWxlY3QoYENPVU5UKC4uLikgQVMgJHtkcml2ZXIucXVvdGVDb2x1bW4oXCJtYW51YWxUYXNrc0NvdW50XCIpfWApXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gSWRlbnRpZmllciB1c2VkIGluIHRoZSBgLnF1ZXJ5RGF0YSguLi4pYCBzcGVjLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3F1ZXJ5L3F1ZXJ5LWRhdGEuanNcIikuUXVlcnlEYXRhRm59IGZuIC0gQ2FsbGJhY2sgdGhhdCBtdXRhdGVzIHRoZSBxdWVyeS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgcXVlcnlEYXRhKG5hbWUsIGZuKSB7XG4gICAgaWYgKCFuYW1lIHx8IHR5cGVvZiBuYW1lICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgcXVlcnlEYXRhIG5hbWU6ICR7bmFtZX1gKVxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgZm4gIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBxdWVyeURhdGEgZm4gZm9yICR7dGhpcy5uYW1lfS5xdWVyeURhdGEoJHtKU09OLnN0cmluZ2lmeShuYW1lKX0pIG11c3QgYmUgYSBmdW5jdGlvbmApXG4gICAgfVxuXG4gICAgY29uc3QgbWFwID0gdGhpcy5nZXRRdWVyeURhdGFNYXAoKVxuXG4gICAgLy8gVXNlIE9iamVjdC5oYXNPd24gc28gYSBuYW1lIHRoYXQgaGFwcGVucyB0byBtYXRjaCBhbiBpbmhlcml0ZWRcbiAgICAvLyBPYmplY3QucHJvdG90eXBlIGtleSAoZS5nLiBcInRvU3RyaW5nXCIsIFwiY29uc3RydWN0b3JcIikgaXNuJ3RcbiAgICAvLyBmYWxzZWx5IHRyZWF0ZWQgYXMgYWxyZWFkeSByZWdpc3RlcmVkLlxuICAgIGlmIChPYmplY3QuaGFzT3duKG1hcCwgbmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgcXVlcnlEYXRhIGZvciAke3RoaXMubmFtZX0uJHtuYW1lfSBpcyBhbHJlYWR5IHJlZ2lzdGVyZWRgKVxuICAgIH1cblxuICAgIG1hcFtuYW1lXSA9IGZuXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcXVlcnkgZGF0YSBtYXAuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9xdWVyeS9xdWVyeS1kYXRhLmpzXCIpLlF1ZXJ5RGF0YUZuPn0gLSBxdWVyeURhdGEgcmVnaXN0cmF0aW9ucyBrZXllZCBieSBuYW1lLlxuICAgKi9cbiAgc3RhdGljIGdldFF1ZXJ5RGF0YU1hcCgpIHtcbiAgICBpZiAoIU9iamVjdC5oYXNPd24odGhpcywgXCJfcXVlcnlEYXRhUmVnaXN0cmF0aW9uc1wiKSB8fCAhdGhpcy5fcXVlcnlEYXRhUmVnaXN0cmF0aW9ucykge1xuICAgICAgLy8gUHJvdG90eXBlLWxlc3MgbWFwIHNvIGJyYWNrZXQgYWNjZXNzIGNhbiBvbmx5IGV2ZXIgc3VyZmFjZVxuICAgICAgLy8gcmVnaXN0cmF0aW9ucyBhY3R1YWxseSBtYWRlIG9uIHRoaXMgY2xhc3Mg4oCUIG5ldmVyIGluaGVyaXRlZFxuICAgICAgLy8gT2JqZWN0LnByb3RvdHlwZSBtZW1iZXJzLlxuICAgICAgLyoqXG4gICAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vcXVlcnkvcXVlcnktZGF0YS5qc1wiKS5RdWVyeURhdGFGbj59ICovXG4gICAgICB0aGlzLl9xdWVyeURhdGFSZWdpc3RyYXRpb25zID0gT2JqZWN0LmNyZWF0ZShudWxsKVxuICAgIH1cblxuICAgIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL3F1ZXJ5L3F1ZXJ5LWRhdGEuanNcIikuUXVlcnlEYXRhRm4+fSAqLyAodGhpcy5fcXVlcnlEYXRhUmVnaXN0cmF0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBxdWVyeSBkYXRhIGJ5IG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gcXVlcnlEYXRhIG5hbWUuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9xdWVyeS9xdWVyeS1kYXRhLmpzXCIpLlF1ZXJ5RGF0YUZuIHwgbnVsbH0gLSBSZWdpc3RlcmVkIGZuIG9yIG51bGwgd2hlbiBub3QgZm91bmQuXG4gICAqL1xuICBzdGF0aWMgZ2V0UXVlcnlEYXRhQnlOYW1lKG5hbWUpIHtcbiAgICBjb25zdCBtYXAgPSB0aGlzLmdldFF1ZXJ5RGF0YU1hcCgpXG5cbiAgICAvLyBPd24tcHJvcGVydHkgbG9va3VwIHNvIGEgc3BlYyBjb250YWluaW5nIGUuZy4gXCJ0b1N0cmluZ1wiIGRvZXNuJ3RcbiAgICAvLyByZXNvbHZlIHRvIGFuIGluaGVyaXRlZCBPYmplY3QucHJvdG90eXBlIG1lbWJlciDigJQgbWF0Y2hpbmcgdGhlXG4gICAgLy8gT2JqZWN0Lmhhc093biBndWFyZCB1c2VkIHdoZW4gcmVnaXN0ZXJpbmcuXG4gICAgcmV0dXJuIE9iamVjdC5oYXNPd24obWFwLCBuYW1lKSA/IG1hcFtuYW1lXSA6IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBhdHRhY2htZW50cy5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIHtkcml2ZXI/OiBzdHJpbmcgfCBBdHRhY2htZW50RHJpdmVyQ29uc3RydWN0b3IgfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIHR5cGU6IFwiaGFzT25lXCIgfCBcImhhc01hbnlcIn0+fSAtIEF0dGFjaG1lbnQgZGVmaW5pdGlvbnMuXG4gICAqL1xuICBzdGF0aWMgZ2V0QXR0YWNobWVudHMoKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0QXR0YWNobWVudHNNYXAoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGF0dGFjaG1lbnQgYnkgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dGFjaG1lbnROYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcmV0dXJucyB7e2RyaXZlcj86IHN0cmluZyB8IEF0dGFjaG1lbnREcml2ZXJDb25zdHJ1Y3RvciB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiwgdHlwZTogXCJoYXNPbmVcIiB8IFwiaGFzTWFueVwifX0gLSBBdHRhY2htZW50IGRlZmluaXRpb24uXG4gICAqL1xuICBzdGF0aWMgZ2V0QXR0YWNobWVudEJ5TmFtZShhdHRhY2htZW50TmFtZSkge1xuICAgIGNvbnN0IGRlZmluaXRpb24gPSB0aGlzLmdldEF0dGFjaG1lbnRzTWFwKClbYXR0YWNobWVudE5hbWVdXG5cbiAgICBpZiAoIWRlZmluaXRpb24pIHRocm93IG5ldyBFcnJvcihgTm8gYXR0YWNobWVudCBpbiAke3RoaXMubmFtZX0gY2FsbGVkIFwiJHthdHRhY2htZW50TmFtZX1cIiBpbiBsaXN0OiAke09iamVjdC5rZXlzKHRoaXMuZ2V0QXR0YWNobWVudHNNYXAoKSkuam9pbihcIiwgXCIpfWApXG5cbiAgICByZXR1cm4gZGVmaW5pdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHJlbGF0aW9uc2hpcCBieSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9pbnN0YW5jZS1yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdH0gLSBUaGUgcmVsYXRpb25zaGlwIGJ5IG5hbWUuXG4gICAqL1xuICBnZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSkge1xuICAgIGlmICghKHJlbGF0aW9uc2hpcE5hbWUgaW4gdGhpcy5faW5zdGFuY2VSZWxhdGlvbnNoaXBzKSkge1xuICAgICAgY29uc3QgbW9kZWxDbGFzc1JlbGF0aW9uc2hpcCA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpXG4gICAgICAgIC5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcbiAgICAgICAgLnJlc29sdmVGb3JSZWNvcmQodGhpcylcbiAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcFR5cGUgPSBtb2RlbENsYXNzUmVsYXRpb25zaGlwLmdldFR5cGUoKVxuICAgICAgbGV0IGluc3RhbmNlUmVsYXRpb25zaGlwXG5cbiAgICAgIGlmIChyZWxhdGlvbnNoaXBUeXBlID09IFwiYmVsb25nc1RvXCIpIHtcbiAgICAgICAgaW5zdGFuY2VSZWxhdGlvbnNoaXAgPSBuZXcgQmVsb25nc1RvSW5zdGFuY2VSZWxhdGlvbnNoaXAoe21vZGVsOiB0aGlzLCByZWxhdGlvbnNoaXA6IG1vZGVsQ2xhc3NSZWxhdGlvbnNoaXB9KVxuICAgICAgfSBlbHNlIGlmIChyZWxhdGlvbnNoaXBUeXBlID09IFwiaGFzTWFueVwiKSB7XG4gICAgICAgIGluc3RhbmNlUmVsYXRpb25zaGlwID0gbmV3IEhhc01hbnlJbnN0YW5jZVJlbGF0aW9uc2hpcCh7bW9kZWw6IHRoaXMsIHJlbGF0aW9uc2hpcDogbW9kZWxDbGFzc1JlbGF0aW9uc2hpcH0pXG4gICAgICB9IGVsc2UgaWYgKHJlbGF0aW9uc2hpcFR5cGUgPT0gXCJoYXNPbmVcIikge1xuICAgICAgICBpbnN0YW5jZVJlbGF0aW9uc2hpcCA9IG5ldyBIYXNPbmVJbnN0YW5jZVJlbGF0aW9uc2hpcCh7bW9kZWw6IHRoaXMsIHJlbGF0aW9uc2hpcDogbW9kZWxDbGFzc1JlbGF0aW9uc2hpcH0pXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gcmVsYXRpb25zaGlwIHR5cGU6ICR7cmVsYXRpb25zaGlwVHlwZX1gKVxuICAgICAgfVxuXG4gICAgICB0aGlzLl9pbnN0YW5jZVJlbGF0aW9uc2hpcHNbcmVsYXRpb25zaGlwTmFtZV0gPSBpbnN0YW5jZVJlbGF0aW9uc2hpcFxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9pbnN0YW5jZVJlbGF0aW9uc2hpcHNbcmVsYXRpb25zaGlwTmFtZV1cbiAgfVxuXG4gIC8qKlxuICAgKiBQcmVsb2FkcyByZWxhdGlvbnNoaXAocykgb250byB0aGlzIGFscmVhZHktbG9hZGVkIHJlY29yZC4gQWNjZXB0cyBlaXRoZXIgYVxuICAgKiBxdWVyeSBidWlsdCB2aWEgYE1vZGVsLnByZWxvYWQoLi4uKS5zZWxlY3QoLi4uKWAgb3IgYSByYXcgcHJlbG9hZCBzcGVjXG4gICAqIChzdHJpbmcgLyBhcnJheSAvIG5lc3RlZCBvYmplY3QpLiBBIHJlbGF0aW9uc2hpcCB0aGF0IGlzIGFscmVhZHkgcHJlbG9hZGVkXG4gICAqIHdpdGggYWxsIHRoZSByZXF1aXJlZCBjb2x1bW5zIHByZXNlbnQgaXMgbGVmdCB1bnRvdWNoZWQgdW5sZXNzIGBmb3JjZWAgaXNcbiAgICogc2V0LiBQcmVsb2FkaW5nIG9udG8gdGhlIHJlbGF0aW9uc2hpcCBjYWNoZSBsZXRzIGxhdGVyIGFjY2Vzc29ycyByZXVzZSB0aGVcbiAgICogbG9hZGVkIGRhdGEgaW5zdGVhZCBvZiBpc3N1aW5nIGlkZW50aWNhbCBxdWVyaWVzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQgfCBpbXBvcnQoXCIuLi9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkIHwgc3RyaW5nIHwgQXJyYXk8c3RyaW5nIHwgaW1wb3J0KFwiLi4vcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZD59IHF1ZXJ5T3JTcGVjIC0gUHJlbG9hZCBzb3VyY2UuXG4gICAqIEBwYXJhbSB7e2ZvcmNlPzogYm9vbGVhbn19IFtvcHRpb25zXSAtIE9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcHJlbG9hZGluZyBjb21wbGV0ZXMuXG4gICAqL1xuICBhc3luYyBwcmVsb2FkKHF1ZXJ5T3JTcGVjLCBvcHRpb25zID0ge30pIHtcbiAgICBhd2FpdCBQcmVsb2FkZXIucHJlbG9hZChbdGhpc10sIHF1ZXJ5T3JTcGVjLCBvcHRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9hZCByZWxhdGlvbnNoaXAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBMb2FkZWQgcmVsYXRpb25zaGlwIHZhbHVlLlxuICAgKi9cbiAgYXN5bmMgbG9hZFJlbGF0aW9uc2hpcChyZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgY29uc3QgcmVsYXRpb25zaGlwID0gdGhpcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcblxuICAgIGF3YWl0IHJlbGF0aW9uc2hpcC5sb2FkKClcblxuICAgIHJldHVybiByZWxhdGlvbnNoaXAubG9hZGVkKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbGF0aW9uc2hpcCBvciBsb2FkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcGFyYW0ge3twcmVsb2FkVHJhbnNsYXRpb25zPzogYm9vbGVhbn19IFtvcHRpb25zXSAtIExvYWQgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIExvYWRlZCByZWxhdGlvbnNoaXAgdmFsdWUuXG4gICAqL1xuICBhc3luYyByZWxhdGlvbnNoaXBPckxvYWQocmVsYXRpb25zaGlwTmFtZSwgb3B0aW9ucyA9IHt9KSB7XG4gICAgY29uc3QgcmVsYXRpb25zaGlwID0gdGhpcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcbiAgICBsZXQgbG9hZGVkID0gYXdhaXQgcmVsYXRpb25zaGlwLmF1dG9sb2FkT3JMb2FkKClcblxuICAgIGlmIChvcHRpb25zLnByZWxvYWRUcmFuc2xhdGlvbnMpIHtcbiAgICAgIGxvYWRlZCA9IGF3YWl0IHRoaXMuX3ByZWxvYWRMb2FkZWRSZWxhdGlvbnNoaXBUcmFuc2xhdGlvbnMobG9hZGVkKVxuICAgIH1cblxuICAgIHJldHVybiBsb2FkZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBQcmVsb2FkcyB0cmFuc2xhdGlvbnMgb24gYSBsb2FkZWQgcmVsYXRpb25zaGlwIHRhcmdldCB3aGVuIGV4cGxpY2l0bHkgcmVxdWVzdGVkLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBsb2FkZWQgLSBMb2FkZWQgcmVsYXRpb25zaGlwIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVsYXRpb25zaGlwIHZhbHVlIGFmdGVyIHRyYW5zbGF0aW9uIHByZWxvYWQuXG4gICAqL1xuICBhc3luYyBfcHJlbG9hZExvYWRlZFJlbGF0aW9uc2hpcFRyYW5zbGF0aW9ucyhsb2FkZWQpIHtcbiAgICBpZiAoIWxvYWRlZCB8fCAhbG9hZGVkLmlzUGVyc2lzdGVkKCkgfHwgIWF3YWl0IGxvYWRlZC5nZXRNb2RlbENsYXNzKCkuaGFzVHJhbnNsYXRpb25zVGFibGUoKSkgcmV0dXJuIGxvYWRlZFxuXG4gICAgY29uc3QgdHJhbnNsYXRpb25zUmVsYXRpb25zaGlwID0gbG9hZGVkLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShcInRyYW5zbGF0aW9uc1wiKVxuXG4gICAgaWYgKHRyYW5zbGF0aW9uc1JlbGF0aW9uc2hpcC5nZXRQcmVsb2FkZWQoKSkgcmV0dXJuIGxvYWRlZFxuXG4gICAgYXdhaXQgbG9hZGVkLnByZWxvYWQoe3RyYW5zbGF0aW9uczoge319KVxuXG4gICAgcmV0dXJuIGxvYWRlZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGF0dGFjaG1lbnQgYnkgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dGFjaG1lbnROYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkQXR0YWNobWVudEhhbmRsZX0gLSBBdHRhY2htZW50IGhhbmRsZS5cbiAgICovXG4gIGdldEF0dGFjaG1lbnRCeU5hbWUoYXR0YWNobWVudE5hbWUpIHtcbiAgICBpZiAoIShhdHRhY2htZW50TmFtZSBpbiB0aGlzLl9hdHRhY2htZW50cykpIHtcbiAgICAgIGNvbnN0IGF0dGFjaG1lbnREZWZpbml0aW9uID0gdGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0QXR0YWNobWVudEJ5TmFtZShhdHRhY2htZW50TmFtZSlcblxuICAgICAgdGhpcy5fYXR0YWNobWVudHNbYXR0YWNobWVudE5hbWVdID0gbmV3IFJlY29yZEF0dGFjaG1lbnRIYW5kbGUoe1xuICAgICAgICBtb2RlbDogdGhpcyxcbiAgICAgICAgbmFtZTogYXR0YWNobWVudE5hbWUsXG4gICAgICAgIHR5cGU6IGF0dGFjaG1lbnREZWZpbml0aW9uLnR5cGVcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2F0dGFjaG1lbnRzW2F0dGFjaG1lbnROYW1lXVxuICB9XG5cbiAgLyoqXG4gICAqIEFkZHMgYSBiZWxvbmdzLXRvLXJlbGF0aW9uc2hpcCB0byB0aGUgbW9kZWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIFRoZSBuYW1lIG9mIHRoZSByZWxhdGlvbnNoaXAuXG4gICAqIEBwYXJhbSB7UmVsYXRpb25zaGlwU2NvcGVDYWxsYmFjayB8IG9iamVjdH0gW3Njb3BlT3JPcHRpb25zXSBUaGUgc2NvcGUgY2FsbGJhY2sgb3Igb3B0aW9ucyBmb3IgdGhlIHJlbGF0aW9uc2hpcC5cbiAgICogQHBhcmFtIHtvYmplY3R9IFtvcHRpb25zXSBUaGUgb3B0aW9ucyBmb3IgdGhlIHJlbGF0aW9uc2hpcC5cbiAgICovXG4gIHN0YXRpYyBiZWxvbmdzVG8ocmVsYXRpb25zaGlwTmFtZSwgc2NvcGVPck9wdGlvbnMsIG9wdGlvbnMpIHtcbiAgICBjb25zdCB7c2NvcGUsIHJlbGF0aW9uc2hpcE9wdGlvbnN9ID0gdGhpcy5fbm9ybWFsaXplUmVsYXRpb25zaGlwQXJncyhzY29wZU9yT3B0aW9ucywgb3B0aW9ucylcblxuICAgIHRoaXMuX2RlZmluZVJlbGF0aW9uc2hpcChyZWxhdGlvbnNoaXBOYW1lLCBPYmplY3QuYXNzaWduKHt0eXBlOiBcImJlbG9uZ3NUb1wiLCBzY29wZX0sIHJlbGF0aW9uc2hpcE9wdGlvbnMpKVxuXG4gICAgaWYgKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChyZWxhdGlvbnNoaXBPcHRpb25zKT8uY291bnRlckNhY2hlKSB7XG4gICAgICB0aGlzLl9yZWdpc3RlckNvdW50ZXJDYWNoZUNhbGxiYWNrcyhyZWxhdGlvbnNoaXBOYW1lKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmVuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlXSAtIFdoZXRoZXIgdGVuYW50LXN3aXRjaGVkIG1vZGVscyBtdXN0IHJlc29sdmUgYSB0ZW5hbnQgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSAtIFRoZSBjb25uZWN0aW9uLlxuICAgKi9cbiAgc3RhdGljIGNvbm5lY3Rpb24oe2VuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlID0gdHJ1ZSwgLi4ucmVzdEFyZ3N9ID0ge30pIHtcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuXG4gICAgY29uc3QgZGF0YWJhc2VQb29sID0gdGhpcy5fZ2V0Q29uZmlndXJhdGlvbigpLmdldERhdGFiYXNlUG9vbCh0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcih7ZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGV9KSlcbiAgICBjb25zdCBjb25uZWN0aW9uID0gZGF0YWJhc2VQb29sLmdldEN1cnJlbnRDb25uZWN0aW9uKClcblxuICAgIGlmICghY29ubmVjdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiTm8gY29ubmVjdGlvbj9cIilcblxuICAgIHJldHVybiBjb25uZWN0aW9uXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjcmVhdGUuXG4gICAqIEB0ZW1wbGF0ZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBDcmVhdGVBdHRyaWJ1dGVzXG4gICAqIEB0ZW1wbGF0ZSB7VmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQ8Q3JlYXRlQXR0cmlidXRlcz59IE1vZGVsXG4gICAqIEB0aGlzIHt7bmV3IChjaGFuZ2VzPzogQ3JlYXRlQXR0cmlidXRlcyk6IE1vZGVsfSAmIHR5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH1cbiAgICogQHBhcmFtIHtDcmVhdGVBdHRyaWJ1dGVzfSBbYXR0cmlidXRlc10gLSBBdHRyaWJ1dGVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxNb2RlbD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY3JlYXRlLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGNyZWF0ZShhdHRyaWJ1dGVzKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpXG5cbiAgICBjb25zdCByZWNvcmQgPSAvKiogQHR5cGUge01vZGVsfSAqLyAobmV3IHRoaXMoYXR0cmlidXRlcykpXG5cbiAgICBhd2FpdCByZWNvcmQuc2F2ZSgpXG5cbiAgICByZXR1cm4gcmVjb3JkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gLSBUaGUgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIHN0YXRpYyBfZ2V0Q29uZmlndXJhdGlvbigpIHtcbiAgICBpZiAoIXRoaXMuX2NvbmZpZ3VyYXRpb24pIHtcbiAgICAgIHRoaXMuX2NvbmZpZ3VyYXRpb24gPSBDb25maWd1cmF0aW9uLmN1cnJlbnQoKVxuXG4gICAgICBpZiAoIXRoaXMuX2NvbmZpZ3VyYXRpb24pIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ29uZmlndXJhdGlvbiBoYXNuJ3QgYmVlbiBzZXQgKG1vZGVsIGNsYXNzIHByb2JhYmx5IGhhc24ndCBiZWVuIGluaXRpYWxpemVkKVwiKVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9jb25maWd1cmF0aW9uXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gLSBUaGUgY29uZmlndXJhdGlvbi5cbiAgICovXG4gIF9nZXRDb25maWd1cmF0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLmdldE1vZGVsQ2xhc3MoKS5fZ2V0Q29uZmlndXJhdGlvbigpXG4gIH1cblxuICAvKipcbiAgICogQWRkcyBhIGhhcy1tYW55LXJlbGF0aW9uc2hpcCB0byB0aGUgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIFRoZSBuYW1lIG9mIHRoZSByZWxhdGlvbnNoaXAgKGUuZy4gXCJwb3N0c1wiKVxuICAgKiBAcGFyYW0ge1JlbGF0aW9uc2hpcFNjb3BlQ2FsbGJhY2sgfCBvYmplY3R9IFtzY29wZU9yT3B0aW9uc10gVGhlIHNjb3BlIGNhbGxiYWNrIG9yIG9wdGlvbnMgZm9yIHRoZSByZWxhdGlvbnNoaXAuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbb3B0aW9uc10gVGhlIG9wdGlvbnMgZm9yIHRoZSByZWxhdGlvbnNoaXAgKGUuZy4ge2NsYXNzTmFtZTogXCJQb3N0XCJ9KVxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgaGFzTWFueShyZWxhdGlvbnNoaXBOYW1lLCBzY29wZU9yT3B0aW9ucywgb3B0aW9ucykge1xuICAgIGNvbnN0IHtzY29wZSwgcmVsYXRpb25zaGlwT3B0aW9uc30gPSB0aGlzLl9ub3JtYWxpemVSZWxhdGlvbnNoaXBBcmdzKHNjb3BlT3JPcHRpb25zLCBvcHRpb25zKVxuXG4gICAgcmV0dXJuIHRoaXMuX2RlZmluZVJlbGF0aW9uc2hpcChyZWxhdGlvbnNoaXBOYW1lLCBPYmplY3QuYXNzaWduKHt0eXBlOiBcImhhc01hbnlcIiwgc2NvcGV9LCByZWxhdGlvbnNoaXBPcHRpb25zKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSYWlscy1zdHlsZSBkZWNsYXJhdGlvbiB0aGF0IHRoaXMgbW9kZWwgYWNjZXB0cyBuZXN0ZWQtYXR0cmlidXRlIHdyaXRlc1xuICAgKiBmb3IgYSByZWxhdGlvbnNoaXAgd2hlbiBzYXZlZCB0aHJvdWdoIGEgcGFyZW50LiBSZXF1aXJlZCDigJQgVmVsb2Npb3VzXG4gICAqIHdpbGwgcmVmdXNlIG5lc3RlZCB3cml0ZXMgZm9yIGFueSByZWxhdGlvbnNoaXAgbm90IGxpc3RlZCBoZXJlLCBldmVuXG4gICAqIGlmIGEgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2UgcGVybWl0cyB0aGVtLlxuICAgKlxuICAgKiBPcHRpb25zOlxuICAgKiAgIC0gYWxsb3dEZXN0cm95OiB3aGV0aGVyIGBfZGVzdHJveTogdHJ1ZWAgZW50cmllcyBhcmUgYWxsb3dlZC4gRGVmYXVsdCBmYWxzZS5cbiAgICogICAtIGxpbWl0OiBvcHRpb25hbCB1cHBlciBib3VuZCBvbiB0aGUgbnVtYmVyIG9mIG5lc3RlZCBlbnRyaWVzIHBlciByZXF1ZXN0LlxuICAgKiAgIC0gcmVqZWN0SWY6IG9wdGlvbmFsIHByZWRpY2F0ZSBgKGF0dHJpYnV0ZXMpID0+IGJvb2xlYW5gIHRoYXQgc2lsZW50bHkgc2tpcHMgZW50cmllcy5cbiAgICpcbiAgICogVXNhZ2U6XG4gICAqICAgY2xhc3MgUHJvamVjdCBleHRlbmRzIFJlY29yZCB7fVxuICAgKiAgIFByb2plY3QuaGFzTWFueShcInRhc2tzXCIpXG4gICAqICAgUHJvamVjdC5hY2NlcHRzTmVzdGVkQXR0cmlidXRlc0ZvcihcInRhc2tzXCIsIHthbGxvd0Rlc3Ryb3k6IHRydWV9KVxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lIG9uIHRoaXMgbW9kZWwuXG4gICAqIEBwYXJhbSB7e2FsbG93RGVzdHJveT86IGJvb2xlYW4sIGxpbWl0PzogbnVtYmVyLCByZWplY3RJZj86IChhdHRyaWJ1dGVzOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IGJvb2xlYW59fSBbb3B0aW9uc10gLSBQb2xpY3kgb3B0aW9ucy5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgYWNjZXB0c05lc3RlZEF0dHJpYnV0ZXNGb3IocmVsYXRpb25zaGlwTmFtZSwgb3B0aW9ucyA9IHt9KSB7XG4gICAgaWYgKCFyZWxhdGlvbnNoaXBOYW1lIHx8IHR5cGVvZiByZWxhdGlvbnNoaXBOYW1lICE9PSBcInN0cmluZ1wiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgcmVsYXRpb25zaGlwTmFtZSBwYXNzZWQgdG8gYWNjZXB0c05lc3RlZEF0dHJpYnV0ZXNGb3I6ICR7cmVsYXRpb25zaGlwTmFtZX1gKVxuICAgIH1cblxuICAgIGlmICghT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKHRoaXMsIFwiX2FjY2VwdGVkTmVzdGVkQXR0cmlidXRlc1wiKSkge1xuICAgICAgLyoqXG4gICAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywge2FsbG93RGVzdHJveT86IGJvb2xlYW4sIGxpbWl0PzogbnVtYmVyLCByZWplY3RJZj86IChhdHRyaWJ1dGVzOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IGJvb2xlYW59Pn0gKi9cbiAgICAgIHRoaXMuX2FjY2VwdGVkTmVzdGVkQXR0cmlidXRlcyA9IHt9XG4gICAgfVxuXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB7YWxsb3dEZXN0cm95PzogYm9vbGVhbiwgbGltaXQ/OiBudW1iZXIsIHJlamVjdElmPzogKGF0dHJpYnV0ZXM6IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PikgPT4gYm9vbGVhbn0+fSAqLyAodGhpcy5fYWNjZXB0ZWROZXN0ZWRBdHRyaWJ1dGVzKVtyZWxhdGlvbnNoaXBOYW1lXSA9IHsuLi5vcHRpb25zfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWNjZXB0ZWQgbmVzdGVkIGF0dHJpYnV0ZXMgZm9yLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcmV0dXJucyB7e2FsbG93RGVzdHJveT86IGJvb2xlYW4sIGxpbWl0PzogbnVtYmVyLCByZWplY3RJZj86IChhdHRyaWJ1dGVzOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IGJvb2xlYW59IHwgbnVsbH0gLSBQb2xpY3kgZGVjbGFyZWQgdmlhIGBhY2NlcHRzTmVzdGVkQXR0cmlidXRlc0ZvcmAsIG9yIG51bGwgd2hlbiBub3QgYWNjZXB0ZWQuXG4gICAqL1xuICBzdGF0aWMgYWNjZXB0ZWROZXN0ZWRBdHRyaWJ1dGVzRm9yKHJlbGF0aW9uc2hpcE5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5fYWNjZXB0ZWROZXN0ZWRBdHRyaWJ1dGVzPy5bcmVsYXRpb25zaGlwTmFtZV0gfHwgbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIEFkZHMgYSBoYXMtb25lLXJlbGF0aW9uc2hpcCB0byB0aGUgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIFRoZSBuYW1lIG9mIHRoZSByZWxhdGlvbnNoaXAgKGUuZy4gXCJwb3N0XCIpXG4gICAqIEBwYXJhbSB7UmVsYXRpb25zaGlwU2NvcGVDYWxsYmFjayB8IG9iamVjdH0gW3Njb3BlT3JPcHRpb25zXSBUaGUgc2NvcGUgY2FsbGJhY2sgb3Igb3B0aW9ucyBmb3IgdGhlIHJlbGF0aW9uc2hpcC5cbiAgICogQHBhcmFtIHtvYmplY3R9IFtvcHRpb25zXSBUaGUgb3B0aW9ucyBmb3IgdGhlIHJlbGF0aW9uc2hpcCAoZS5nLiB7Y2xhc3NOYW1lOiBcIlBvc3RcIn0pXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBoYXNPbmUocmVsYXRpb25zaGlwTmFtZSwgc2NvcGVPck9wdGlvbnMsIG9wdGlvbnMpIHtcbiAgICBjb25zdCB7c2NvcGUsIHJlbGF0aW9uc2hpcE9wdGlvbnN9ID0gdGhpcy5fbm9ybWFsaXplUmVsYXRpb25zaGlwQXJncyhzY29wZU9yT3B0aW9ucywgb3B0aW9ucylcblxuICAgIHJldHVybiB0aGlzLl9kZWZpbmVSZWxhdGlvbnNoaXAocmVsYXRpb25zaGlwTmFtZSwgT2JqZWN0LmFzc2lnbih7dHlwZTogXCJoYXNPbmVcIiwgc2NvcGV9LCByZWxhdGlvbnNoaXBPcHRpb25zKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlZmluZSBhdHRhY2htZW50LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0YWNobWVudE5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXR0YWNobWVudCBhcmdzLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IEF0dGFjaG1lbnREcml2ZXJDb25zdHJ1Y3RvciB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW2FyZ3MuZHJpdmVyXSAtIEF0dGFjaG1lbnQgZHJpdmVyIG5hbWUsIGNsYXNzLCBvciBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtcImhhc09uZVwiIHwgXCJoYXNNYW55XCJ9IGFyZ3MudHlwZSAtIEF0dGFjaG1lbnQgdHlwZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIF9kZWZpbmVBdHRhY2htZW50KGF0dGFjaG1lbnROYW1lLCB7ZHJpdmVyLCB0eXBlfSkge1xuICAgIGlmICghYXR0YWNobWVudE5hbWUgfHwgdHlwZW9mIGF0dGFjaG1lbnROYW1lICE9PSBcInN0cmluZ1wiKSB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgYXR0YWNobWVudCBuYW1lOiAke2F0dGFjaG1lbnROYW1lfWApXG4gICAgaWYgKGF0dGFjaG1lbnROYW1lIGluIHRoaXMuZ2V0QXR0YWNobWVudHNNYXAoKSkgdGhyb3cgbmV3IEVycm9yKGBBdHRhY2htZW50ICR7YXR0YWNobWVudE5hbWV9IGFscmVhZHkgZXhpc3RzYClcblxuICAgIHRoaXMuZ2V0QXR0YWNobWVudHNNYXAoKVthdHRhY2htZW50TmFtZV0gPSB7ZHJpdmVyLCB0eXBlfVxuXG4gICAgY29uc3QgcHJvdG90eXBlID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcy5wcm90b3R5cGUpKVxuXG4gICAgcHJvdG90eXBlW2F0dGFjaG1lbnROYW1lXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuIHRoaXMuZ2V0QXR0YWNobWVudEJ5TmFtZShhdHRhY2htZW50TmFtZSlcbiAgICB9XG5cbiAgICAgIHByb3RvdHlwZVtgc2V0JHtpbmZsZWN0aW9uLmNhbWVsaXplKGF0dGFjaG1lbnROYW1lKX1gXSA9IGZ1bmN0aW9uKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIG5ld1ZhbHVlKSB7XG4gICAgICB0aGlzLmdldEF0dGFjaG1lbnRCeU5hbWUoYXR0YWNobWVudE5hbWUpLnF1ZXVlQXR0YWNoKG5ld1ZhbHVlKVxuICAgICAgcmV0dXJuIG5ld1ZhbHVlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFkZHMgYSBzaW5nbGUgYXR0YWNobWVudCBoZWxwZXIgdG8gdGhlIG1vZGVsLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0YWNobWVudE5hbWUgLSBBdHRhY2htZW50IG5hbWUuXG4gICAqIEBwYXJhbSB7e2RyaXZlcj86IHN0cmluZyB8IEF0dGFjaG1lbnREcml2ZXJDb25zdHJ1Y3RvciB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IFthcmdzXSAtIEF0dGFjaG1lbnQgb3B0aW9ucy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIGhhc09uZUF0dGFjaG1lbnQoYXR0YWNobWVudE5hbWUsIGFyZ3MgPSB7fSkge1xuICAgIHRoaXMuX2RlZmluZUF0dGFjaG1lbnQoYXR0YWNobWVudE5hbWUsIHtkcml2ZXI6IGFyZ3MuZHJpdmVyLCB0eXBlOiBcImhhc09uZVwifSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBZGRzIGEgY29sbGVjdGlvbiBhdHRhY2htZW50IGhlbHBlciB0byB0aGUgbW9kZWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRhY2htZW50TmFtZSAtIEF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHBhcmFtIHt7ZHJpdmVyPzogc3RyaW5nIHwgQXR0YWNobWVudERyaXZlckNvbnN0cnVjdG9yIHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gW2FyZ3NdIC0gQXR0YWNobWVudCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgaGFzTWFueUF0dGFjaG1lbnRzKGF0dGFjaG1lbnROYW1lLCBhcmdzID0ge30pIHtcbiAgICB0aGlzLl9kZWZpbmVBdHRhY2htZW50KGF0dGFjaG1lbnROYW1lLCB7ZHJpdmVyOiBhcmdzLmRyaXZlciwgdHlwZTogXCJoYXNNYW55XCJ9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaHVtYW4gYXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIGh1bWFuIGF0dHJpYnV0ZSBuYW1lLlxuICAgKi9cbiAgc3RhdGljIGh1bWFuQXR0cmlidXRlTmFtZShhdHRyaWJ1dGVOYW1lKSB7XG4gICAgY29uc3QgbW9kZWxOYW1lS2V5ID0gaW5mbGVjdGlvbi51bmRlcnNjb3JlKHRoaXMuZ2V0TW9kZWxOYW1lKCkpXG5cbiAgICByZXR1cm4gdGhpcy5fZ2V0Q29uZmlndXJhdGlvbigpLmdldFRyYW5zbGF0b3IoKShgdmVsb2Npb3VzLmRhdGFiYXNlLnJlY29yZC5hdHRyaWJ1dGVzLiR7bW9kZWxOYW1lS2V5fS4ke2F0dHJpYnV0ZU5hbWV9YCwge2RlZmF1bHRWYWx1ZTogaW5mbGVjdGlvbi5jYW1lbGl6ZShhdHRyaWJ1dGVOYW1lKX0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGF0YWJhc2UgdHlwZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgZGF0YWJhc2UgdHlwZS5cbiAgICovXG4gIHN0YXRpYyBnZXREYXRhYmFzZVR5cGUoKSB7XG4gICAgaWYgKCF0aGlzLl9kYXRhYmFzZVR5cGUpIHRocm93IG5ldyBFcnJvcihcIkRhdGFiYXNlIHR5cGUgaGFzbid0IGJlZW4gc2V0XCIpXG5cbiAgICByZXR1cm4gdGhpcy5fZGF0YWJhc2VUeXBlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgZWFnZXIgbG9hZCByZWNvcmQgbWV0YWRhdGEuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gZWFnZXJMb2FkUmVjb3JkTWV0YWRhdGEgLSBXaGV0aGVyIHJlcXVpcmUtY29udGV4dCBpbml0aWFsaXphdGlvbiBzaG91bGQgbG9hZCB0YWJsZSBtZXRhZGF0YSBmb3IgdGhpcyBtb2RlbC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIHNldEVhZ2VyTG9hZFJlY29yZE1ldGFkYXRhKGVhZ2VyTG9hZFJlY29yZE1ldGFkYXRhKSB7XG4gICAgdGhpcy5fZWFnZXJMb2FkUmVjb3JkTWV0YWRhdGEgPSBlYWdlckxvYWRSZWNvcmRNZXRhZGF0YVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGVhZ2VyIGxvYWQgcmVjb3JkIG1ldGFkYXRhLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHJlcXVpcmUtY29udGV4dCBpbml0aWFsaXphdGlvbiBzaG91bGQgbG9hZCB0YWJsZSBtZXRhZGF0YSBmb3IgdGhpcyBtb2RlbC5cbiAgICovXG4gIHN0YXRpYyBnZXRFYWdlckxvYWRSZWNvcmRNZXRhZGF0YSgpIHtcbiAgICBpZiAodGhpcy5fZWFnZXJMb2FkUmVjb3JkTWV0YWRhdGEgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHRydWVcblxuICAgIHJldHVybiB0aGlzLl9lYWdlckxvYWRSZWNvcmRNZXRhZGF0YVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVzZXQgcmVjb3JkIG1ldGFkYXRhLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgcmVzZXRSZWNvcmRNZXRhZGF0YSgpIHtcbiAgICB0aGlzLl9pbml0aWFsaXplZCA9IGZhbHNlXG4gICAgdGhpcy5faW5pdGlhbGl6ZVJlY29yZFByb21pc2UgPSBudWxsXG4gICAgdGhpcy5fZGF0YWJhc2VUeXBlID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fdGFibGUgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9jb2x1bW5zID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fY29sdW1uc0FzSGFzaCA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX2NvbHVtbk5hbWVzID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fY29sdW1uVHlwZUJ5TmFtZSA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX2F0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWUgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9jb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lID0gdW5kZWZpbmVkXG5cbiAgICBpZiAoIXRoaXMuX3JlY29yZE1ldGFkYXRhTW9kZWxDbGFzcykgdGhpcy5jbGVhclJlY29yZE1ldGFkYXRhVmFsdWVzKClcbiAgfVxuXG4gIC8qKlxuICAgKiBTdGF0aWMgZmllbGRzIHRoYXQgYmVsb25nIHRvIG9uZSBwaHlzaWNhbCBkYXRhYmFzZS9zY2hlbWEgZ2VuZXJhdGlvbi5cbiAgICogQHJldHVybnMge1NldDxzdHJpbmc+fSAtIE1ldGFkYXRhIHByb3BlcnR5IG5hbWVzLlxuICAgKi9cbiAgc3RhdGljIHJlY29yZE1ldGFkYXRhUHJvcGVydHlOYW1lcygpIHtcbiAgICByZXR1cm4gcmVjb3JkTWV0YWRhdGFQcm9wZXJ0eU5hbWVzXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgb25lIG9wZXJhdGlvbi1ib3VuZCBtZXRhZGF0YSBmaWVsZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1ldGFkYXRhS2V5IC0gUGh5c2ljYWwgZGF0YWJhc2UgYW5kIHNjaGVtYSBnZW5lcmF0aW9uIGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHByb3BlcnR5IC0gU3RhdGljIG1ldGFkYXRhIHByb3BlcnR5LlxuICAgKiBAcmV0dXJucyB7UmVjb3JkTWV0YWRhdGFWYWx1ZX0gLSBTdG9yZWQgbWV0YWRhdGEgdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgcmVjb3JkTWV0YWRhdGFWYWx1ZShtZXRhZGF0YUtleSwgcHJvcGVydHkpIHtcbiAgICByZXR1cm4gcmVjb3JkTWV0YWRhdGFWYWx1ZXNGb3IodGhpcykuZ2V0KG1ldGFkYXRhS2V5KT8uZ2V0KHByb3BlcnR5KVxuICB9XG5cbiAgLyoqXG4gICAqIFdyaXRlcyBvbmUgb3BlcmF0aW9uLWJvdW5kIG1ldGFkYXRhIGZpZWxkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWV0YWRhdGFLZXkgLSBQaHlzaWNhbCBkYXRhYmFzZSBhbmQgc2NoZW1hIGdlbmVyYXRpb24ga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcHJvcGVydHkgLSBTdGF0aWMgbWV0YWRhdGEgcHJvcGVydHkuXG4gICAqIEBwYXJhbSB7UmVjb3JkTWV0YWRhdGFWYWx1ZX0gdmFsdWUgLSBNZXRhZGF0YSB2YWx1ZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgc2V0UmVjb3JkTWV0YWRhdGFWYWx1ZShtZXRhZGF0YUtleSwgcHJvcGVydHksIHZhbHVlKSB7XG4gICAgbGV0IHZhbHVlcyA9IHJlY29yZE1ldGFkYXRhVmFsdWVzRm9yKHRoaXMpLmdldChtZXRhZGF0YUtleSlcblxuICAgIGlmICghdmFsdWVzKSB7XG4gICAgICB2YWx1ZXMgPSBuZXcgTWFwKClcbiAgICAgIHJlY29yZE1ldGFkYXRhVmFsdWVzRm9yKHRoaXMpLnNldChtZXRhZGF0YUtleSwgdmFsdWVzKVxuICAgIH1cblxuICAgIHZhbHVlcy5zZXQocHJvcGVydHksIHZhbHVlKVxuICB9XG5cbiAgLyoqIENsZWFycyBldmVyeSB0ZW5hbnQvZ2VuZXJhdGlvbiBtZXRhZGF0YSBzbmFwc2hvdCBmb3IgdGhpcyBtb2RlbC4gKi9cbiAgc3RhdGljIGNsZWFyUmVjb3JkTWV0YWRhdGFWYWx1ZXMoKSB7XG4gICAgcmVjb3JkTWV0YWRhdGFWYWx1ZXNCeU1vZGVsLmRlbGV0ZSh0aGlzKVxuICB9XG5cbiAgLyoqXG4gICAqIENsZWFycyBzbmFwc2hvdHMgd2hvc2Uga2V5IGJlbG9uZ3MgdG8gb25lIHBoeXNpY2FsIGRhdGFiYXNlIGlkZW50aXR5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGF0YWJhc2VJZGVudGl0eSAtIExvZ2ljYWwgaWRlbnRpZmllciBwbHVzIHBvb2wgcmV1c2Uga2V5LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBjbGVhclJlY29yZE1ldGFkYXRhVmFsdWVzRm9yRGF0YWJhc2VJZGVudGl0eShkYXRhYmFzZUlkZW50aXR5KSB7XG4gICAgY29uc3QgdmFsdWVzID0gcmVjb3JkTWV0YWRhdGFWYWx1ZXNCeU1vZGVsLmdldCh0aGlzKVxuXG4gICAgaWYgKCF2YWx1ZXMpIHJldHVyblxuXG4gICAgY29uc3QgbWV0YWRhdGFQcmVmaXggPSBgJHtkYXRhYmFzZUlkZW50aXR5Lmxlbmd0aH06JHtkYXRhYmFzZUlkZW50aXR5fTpgXG5cbiAgICBmb3IgKGNvbnN0IG1ldGFkYXRhS2V5IG9mIHZhbHVlcy5rZXlzKCkpIHtcbiAgICAgIGlmIChtZXRhZGF0YUtleS5zdGFydHNXaXRoKG1ldGFkYXRhUHJlZml4KSkgdmFsdWVzLmRlbGV0ZShtZXRhZGF0YUtleSlcbiAgICB9XG5cbiAgICBpZiAodmFsdWVzLnNpemUgPT09IDApIHJlY29yZE1ldGFkYXRhVmFsdWVzQnlNb2RlbC5kZWxldGUodGhpcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgdGhlIG1vZGVsIGNsYXNzIHdpdGggYSBjb25maWd1cmF0aW9uIHdpdGhvdXQgbG9hZGluZyB0YWJsZSBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyByZWdpc3RlclJlY29yZENsYXNzKHtjb25maWd1cmF0aW9uLCAuLi5yZXN0QXJnc30pIHtcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuXG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoYE5vIGNvbmZpZ3VyYXRpb24gZ2l2ZW4gZm9yICR7dGhpcy5uYW1lfWApXG5cbiAgICB0aGlzLnJlc2V0UmVjb3JkTWV0YWRhdGEoKVxuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSB0aGlzLl9yZWNvcmRNZXRhZGF0YU1vZGVsQ2xhc3MgfHwgdGhpc1xuXG4gICAgbW9kZWxDbGFzcy5fY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICBjb25maWd1cmF0aW9uLnJlZ2lzdGVyTW9kZWxDbGFzcyhtb2RlbENsYXNzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaW5pdGlhbGl6ZSByZWNvcmQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBbYXJncy5jb25uZWN0aW9uXSAtIEV4cGxpY2l0IG1ldGFkYXRhIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgaW5pdGlhbGl6ZVJlY29yZCh7Y29uZmlndXJhdGlvbiwgY29ubmVjdGlvbjogZXhwbGljaXRDb25uZWN0aW9uLCAuLi5yZXN0QXJnc30pIHtcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuXG4gICAgaWYgKCFjb25maWd1cmF0aW9uKSB0aHJvdyBuZXcgRXJyb3IoYE5vIGNvbmZpZ3VyYXRpb24gZ2l2ZW4gZm9yICR7dGhpcy5uYW1lfWApXG5cbiAgICB0aGlzLnJlZ2lzdGVyUmVjb3JkQ2xhc3Moe2NvbmZpZ3VyYXRpb259KVxuICAgIGNvbnN0IGNvbm5lY3Rpb24gPSBleHBsaWNpdENvbm5lY3Rpb24gfHwgdGhpcy5jb25uZWN0aW9uKHtlbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZTogZmFsc2V9KVxuXG4gICAgdGhpcy5fZGF0YWJhc2VUeXBlID0gY29ubmVjdGlvbi5nZXRUeXBlKClcblxuICAgIHRoaXMuX3RhYmxlID0gYXdhaXQgY29ubmVjdGlvbi5nZXRUYWJsZUJ5TmFtZSh0aGlzLnRhYmxlTmFtZSgpKVxuICAgIHRoaXMuX2NvbHVtbnMgPSBhd2FpdCB0aGlzLl9nZXRUYWJsZSgpLmdldENvbHVtbnMoKVxuXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UtY29sdW1uLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICAgIHRoaXMuX2NvbHVtbnNBc0hhc2ggPSB7fVxuXG4gICAgY29uc3QgY29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZSA9IHRoaXMuZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCgpXG4gICAgY29uc3QgYXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZSA9IHRoaXMuZ2V0QXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCgpXG4gICAgY29uc3QgcHJvdG90eXBlID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcy5wcm90b3R5cGUpKVxuXG4gICAgZm9yIChjb25zdCBjb2x1bW4gb2YgdGhpcy5fY29sdW1ucykge1xuICAgICAgdGhpcy5fY29sdW1uc0FzSGFzaFtjb2x1bW4uZ2V0TmFtZSgpXSA9IGNvbHVtblxuXG4gICAgICBjb25zdCBkZWJ1cnJlZENvbHVtbk5hbWUgPSBkZWJ1cnJDb2x1bW5OYW1lKGNvbHVtbi5nZXROYW1lKCkpXG4gICAgICBjb25zdCBjYW1lbGl6ZWRDb2x1bW5OYW1lID0gaW5mbGVjdGlvbi5jYW1lbGl6ZShkZWJ1cnJlZENvbHVtbk5hbWUsIHRydWUpXG4gICAgICBjb25zdCBjYW1lbGl6ZWRDb2x1bW5OYW1lQmlnRmlyc3QgPSBpbmZsZWN0aW9uLmNhbWVsaXplKGRlYnVycmVkQ29sdW1uTmFtZSlcblxuICAgICAgYXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZVtjYW1lbGl6ZWRDb2x1bW5OYW1lXSA9IGNvbHVtbi5nZXROYW1lKClcbiAgICAgIGNvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVbY29sdW1uLmdldE5hbWUoKV0gPSBjYW1lbGl6ZWRDb2x1bW5OYW1lXG5cbiAgICAgIGlmICghKGNhbWVsaXplZENvbHVtbk5hbWUgaW4gcHJvdG90eXBlKSkge1xuICAgICAgICBwcm90b3R5cGVbY2FtZWxpemVkQ29sdW1uTmFtZV0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy5yZWFkQXR0cmlidXRlKGNhbWVsaXplZENvbHVtbk5hbWUpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKCEoYHNldCR7Y2FtZWxpemVkQ29sdW1uTmFtZUJpZ0ZpcnN0fWAgaW4gcHJvdG90eXBlKSkge1xuICAgICAgICBwcm90b3R5cGVbYHNldCR7Y2FtZWxpemVkQ29sdW1uTmFtZUJpZ0ZpcnN0fWBdID0gZnVuY3Rpb24oLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gbmV3VmFsdWUpIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy5fc2V0Q29sdW1uQXR0cmlidXRlKGNhbWVsaXplZENvbHVtbk5hbWUsIG5ld1ZhbHVlKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmICghKGBoYXMke2NhbWVsaXplZENvbHVtbk5hbWVCaWdGaXJzdH1gIGluIHByb3RvdHlwZSkpIHtcbiAgICAgICAgcHJvdG90eXBlW2BoYXMke2NhbWVsaXplZENvbHVtbk5hbWVCaWdGaXJzdH1gXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIGNvbnN0IGR5bmFtaWNUaGlzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCAoLi4uYXJnczogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpXG4gICAgICAgICAgY29uc3QgdmFsdWUgPSBkeW5hbWljVGhpc1tjYW1lbGl6ZWRDb2x1bW5OYW1lXSgpXG5cbiAgICAgICAgICByZXR1cm4gdGhpcy5faGFzQXR0cmlidXRlKHZhbHVlKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5fZGVmaW5lVHJhbnNsYXRpb25NZXRob2RzKGNvbm5lY3Rpb24pXG4gICAgYXdhaXQgaW5pdGlhbGl6ZUF1ZGl0aW5nKHRoaXMpXG4gICAgdGhpcy5faW5pdGlhbGl6ZWQgPSB0cnVlXG4gIH1cblxuICAvKipcbiAgICogSW5pdGlhbGl6ZXMgdGhlIG1vZGVsIGNsYXNzIHRoZSBmaXJzdCB0aW1lIGFuIGFzeW5jIHJlY29yZCBBUEkgbmVlZHMgdGFibGVcbiAgICogbWV0YWRhdGEuIENvbmN1cnJlbnQgY2FsbGVycyBzaGFyZSB0aGUgc2FtZSBpbml0aWFsaXphdGlvbiBwcm9taXNlLCBhbmQgYVxuICAgKiBmYWlsZWQgaW5pdGlhbGl6YXRpb24gY2FuIGJlIHJldHJpZWQgYnkgYSBsYXRlciBjYWxsLlxuICAgKiBAcGFyYW0ge3tjb25maWd1cmF0aW9uPzogaW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0LCBjb25uZWN0aW9uPzogaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9fSBbYXJnc10gLSBPcHRpb25hbCBjb25maWd1cmF0aW9uIGFuZCBleHBsaWNpdCBtZXRhZGF0YSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBtb2RlbCBjbGFzcyBpcyBpbml0aWFsaXplZC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBlbnN1cmVJbml0aWFsaXplZChhcmdzID0ge30pIHtcbiAgICBjb25zdCB7Y29uZmlndXJhdGlvbiwgY29ubmVjdGlvbiwgLi4ucmVzdEFyZ3N9ID0gYXJnc1xuXG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIGlmICh0aGlzLl9pbml0aWFsaXplZCkgcmV0dXJuXG5cbiAgICBpZiAodGhpcy5faW5pdGlhbGl6ZVJlY29yZFByb21pc2UpIHtcbiAgICAgIGF3YWl0IHRoaXMuX2luaXRpYWxpemVSZWNvcmRQcm9taXNlXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCByZXNvbHZlZENvbmZpZ3VyYXRpb24gPSBjb25maWd1cmF0aW9uIHx8IHRoaXMuX2NvbmZpZ3VyYXRpb24gfHwgQ29uZmlndXJhdGlvbi5jdXJyZW50KClcblxuICAgIGNvbnN0IGluaXRpYWxpemVSZWNvcmRQcm9taXNlID0gdGhpcy5pbml0aWFsaXplUmVjb3JkKHtjb25maWd1cmF0aW9uOiByZXNvbHZlZENvbmZpZ3VyYXRpb24sIGNvbm5lY3Rpb259KVxuXG4gICAgdGhpcy5faW5pdGlhbGl6ZVJlY29yZFByb21pc2UgPSBpbml0aWFsaXplUmVjb3JkUHJvbWlzZVxuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGluaXRpYWxpemVSZWNvcmRQcm9taXNlXG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIGlmICh0aGlzLl9pbml0aWFsaXplUmVjb3JkUHJvbWlzZSA9PT0gaW5pdGlhbGl6ZVJlY29yZFByb21pc2UpIHtcbiAgICAgICAgdGhpcy5faW5pdGlhbGl6ZVJlY29yZFByb21pc2UgPSBudWxsXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFzIGF0dHJpYnV0ZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBWYWx1ZSB0byB1c2UuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgYXR0cmlidXRlLlxuICAgKi9cbiAgX2hhc0F0dHJpYnV0ZSh2YWx1ZSkge1xuICAgIGlmICh0eXBlb2YgdmFsdWUgPT0gXCJzdHJpbmdcIikge1xuICAgICAgdmFsdWUgPSB2YWx1ZS50cmltKClcbiAgICB9XG5cbiAgICBpZiAodmFsdWUpIHtcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBpbml0aWFsaXplZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBpbml0aWFsaXplZC5cbiAgICovXG4gIHN0YXRpYyBpc0luaXRpYWxpemVkKCkge1xuICAgIGlmICh0aGlzLl9pbml0aWFsaXplZCkgcmV0dXJuIHRydWVcblxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXNzZXJ0IGhhcyBiZWVuIGluaXRpYWxpemVkLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgX2Fzc2VydEhhc0JlZW5Jbml0aWFsaXplZCgpIHtcbiAgICBpZiAodGhpcy5faW5pdGlhbGl6ZWQpIHJldHVyblxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMubmFtZX0gdXNlZCBiZWZvcmUgaW5pdGlhbGl6YXRpb24uIENhbGwgJHt0aGlzLm5hbWV9LmluaXRpYWxpemVSZWNvcmQoLi4uKSBvciBjb25maWd1cmF0aW9uLmluaXRpYWxpemUoKS5gKVxuICB9XG5cbiAgLyoqXG4gICAqIERlZmluZXMgdHJhbnNsYXRpb24gYWNjZXNzb3JzIGFuZCBpbml0aWFsaXplcyB0aGUgZ2VuZXJhdGVkIHRyYW5zbGF0aW9uXG4gICAqIGNsYXNzIHRocm91Z2ggdGhlIHNhbWUgbWV0YWRhdGEgY29ubmVjdGlvbiBhcyB0aGUgdHJhbnNsYXRlZCBtb2RlbC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gY29ubmVjdGlvbiAtIE1ldGFkYXRhIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdHJhbnNsYXRpb24gbWV0YWRhdGEgaXMgcmVhZHkuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgX2RlZmluZVRyYW5zbGF0aW9uTWV0aG9kcyhjb25uZWN0aW9uKSB7XG4gICAgaWYgKHRoaXMuX3RyYW5zbGF0aW9ucyAmJiBPYmplY3Qua2V5cyh0aGlzLl90cmFuc2xhdGlvbnMpLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IGxvY2FsZXMgPSB0aGlzLl9nZXRDb25maWd1cmF0aW9uKCkuZ2V0TG9jYWxlcygpXG5cbiAgICAgIGlmICghbG9jYWxlcykgdGhyb3cgbmV3IEVycm9yKFwiTG9jYWxlcyBoYXNuJ3QgYmVlbiBzZXQgaW4gdGhlIGNvbmZpZ3VyYXRpb25cIilcblxuICAgICAgY29uc3QgVHJhbnNsYXRpb25DbGFzcyA9IHRoaXMuZ2V0VHJhbnNsYXRpb25DbGFzcygpXG4gICAgICBjb25zdCBCb3VuZFRyYW5zbGF0aW9uQ2xhc3MgPSB0aGlzLl9yZWNvcmRNZXRhZGF0YUJpbmRlciA/IHRoaXMuX3JlY29yZE1ldGFkYXRhQmluZGVyKFRyYW5zbGF0aW9uQ2xhc3MpIDogVHJhbnNsYXRpb25DbGFzc1xuXG4gICAgICBhd2FpdCBCb3VuZFRyYW5zbGF0aW9uQ2xhc3MuaW5pdGlhbGl6ZVJlY29yZCh7XG4gICAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuX2dldENvbmZpZ3VyYXRpb24oKSxcbiAgICAgICAgY29ubmVjdGlvblxuICAgICAgfSlcblxuICAgICAgZm9yIChjb25zdCBuYW1lIGluIHRoaXMuX3RyYW5zbGF0aW9ucykge1xuICAgICAgICBjb25zdCBuYW1lQ2FtZWxpemVkID0gaW5mbGVjdGlvbi5jYW1lbGl6ZShuYW1lKVxuICAgICAgICBjb25zdCBzZXR0ZXJNZXRob2ROYW1lID0gYHNldCR7bmFtZUNhbWVsaXplZH1gXG4gICAgICAgIGNvbnN0IHByb3RvdHlwZSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMucHJvdG90eXBlKSlcblxuICAgICAgICBwcm90b3R5cGVbbmFtZV0gPSBmdW5jdGlvbiBnZXRUcmFuc2xhdGVkQXR0cmlidXRlKCkge1xuICAgICAgICAgIGNvbnN0IGxvY2FsZSA9IHRoaXMuX2dldENvbmZpZ3VyYXRpb24oKS5nZXRMb2NhbGUoKVxuXG4gICAgICAgICAgcmV0dXJuIHRoaXMuX2dldFRyYW5zbGF0ZWRBdHRyaWJ1dGVXaXRoRmFsbGJhY2sobmFtZSwgbG9jYWxlKVxuICAgICAgICB9XG5cbiAgICAgICAgcHJvdG90eXBlW2BoYXMke25hbWVDYW1lbGl6ZWR9YF0gPSBmdW5jdGlvbiBoYXNUcmFuc2xhdGVkQXR0cmlidXRlKCkge1xuICAgICAgICAgIGNvbnN0IGR5bmFtaWNUaGlzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpXG4gICAgICAgICAgY29uc3QgY2FuZGlkYXRlID0gZHluYW1pY1RoaXNbbmFtZV1cblxuICAgICAgICAgIGlmICh0eXBlb2YgY2FuZGlkYXRlID09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICAgICAgY29uc3QgdmFsdWUgPSBjYW5kaWRhdGUuYmluZCh0aGlzKSgpXG5cbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9oYXNBdHRyaWJ1dGUodmFsdWUpXG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgY2FuZGlkYXRlIHRvIGJlIGEgZnVuY3Rpb24gYnV0IGl0IHdhczogJHt0eXBlb2YgY2FuZGlkYXRlfWApXG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcHJvdG90eXBlW3NldHRlck1ldGhvZE5hbWVdID0gZnVuY3Rpb24gc2V0VHJhbnNsYXRlZEF0dHJpYnV0ZSgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyBuZXdWYWx1ZSkge1xuICAgICAgICAgIGNvbnN0IGxvY2FsZSA9IHRoaXMuX2dldENvbmZpZ3VyYXRpb24oKS5nZXRMb2NhbGUoKVxuXG4gICAgICAgICAgcmV0dXJuIHRoaXMuX3NldFRyYW5zbGF0ZWRBdHRyaWJ1dGUobmFtZSwgbG9jYWxlLCBuZXdWYWx1ZSlcbiAgICAgICAgfVxuXG4gICAgICAgIGZvciAoY29uc3QgbG9jYWxlIG9mIGxvY2FsZXMpIHtcbiAgICAgICAgICBjb25zdCBsb2NhbGVDYW1lbGl6ZWQgPSBpbmZsZWN0aW9uLmNhbWVsaXplKGxvY2FsZSlcbiAgICAgICAgICBjb25zdCBnZXR0ZXJNZXRob2ROYW1lTG9jYWxpemVkID0gYCR7bmFtZX0ke2xvY2FsZUNhbWVsaXplZH1gXG4gICAgICAgICAgY29uc3Qgc2V0dGVyTWV0aG9kTmFtZUxvY2FsaXplZCA9IGAke3NldHRlck1ldGhvZE5hbWV9JHtsb2NhbGVDYW1lbGl6ZWR9YFxuICAgICAgICAgIGNvbnN0IGhhc01ldGhvZE5hbWVMb2NhbGl6ZWQgPSBgaGFzJHtpbmZsZWN0aW9uLmNhbWVsaXplKG5hbWUpfSR7bG9jYWxlQ2FtZWxpemVkfWBcblxuICAgICAgICAgIHByb3RvdHlwZVtnZXR0ZXJNZXRob2ROYW1lTG9jYWxpemVkXSA9IGZ1bmN0aW9uIGdldFRyYW5zbGF0ZWRBdHRyaWJ1dGVXaXRoTG9jYWxlKCkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2dldFRyYW5zbGF0ZWRBdHRyaWJ1dGUobmFtZSwgbG9jYWxlKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHByb3RvdHlwZVtzZXR0ZXJNZXRob2ROYW1lTG9jYWxpemVkXSA9IGZ1bmN0aW9uIHNldFRyYW5zbGF0ZWRBdHRyaWJ1dGVXaXRoTG9jYWxlKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIG5ld1ZhbHVlKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fc2V0VHJhbnNsYXRlZEF0dHJpYnV0ZShuYW1lLCBsb2NhbGUsIG5ld1ZhbHVlKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHByb3RvdHlwZVtoYXNNZXRob2ROYW1lTG9jYWxpemVkXSA9IGZ1bmN0aW9uIGhhc1RyYW5zbGF0ZWRBdHRyaWJ1dGUoKSB7XG4gICAgICAgICAgICBjb25zdCBkeW5hbWljVGhpcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKVxuICAgICAgICAgICAgY29uc3QgY2FuZGlkYXRlID0gZHluYW1pY1RoaXNbZ2V0dGVyTWV0aG9kTmFtZUxvY2FsaXplZF1cblxuICAgICAgICAgICAgaWYgKHR5cGVvZiBjYW5kaWRhdGUgPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgICAgIGNvbnN0IHZhbHVlID0gY2FuZGlkYXRlLmJpbmQodGhpcykoKVxuXG4gICAgICAgICAgICAgIHJldHVybiB0aGlzLl9oYXNBdHRyaWJ1dGUodmFsdWUpXG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGNhbmRpZGF0ZSB0byBiZSBhIGZ1bmN0aW9uIGJ1dCBpdCB3YXM6ICR7dHlwZW9mIGNhbmRpZGF0ZX1gKVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjb25maWd1cmVkIGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIGNvbmZpZ3VyZWQgbm9uLXRlbmFudCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKi9cbiAgc3RhdGljIGdldENvbmZpZ3VyZWREYXRhYmFzZUlkZW50aWZpZXIoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2RhdGFiYXNlSWRlbnRpZmllciB8fCBcImRlZmF1bHRcIlxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmVuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlXSAtIFdoZXRoZXIgdGVuYW50LXN3aXRjaGVkIG1vZGVscyBtdXN0IHJlc29sdmUgYSB0ZW5hbnQgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzLnRlbmFudF0gLSBFeHBsaWNpdCB0ZW5hbnQgZGVzY3JpcHRvciBpbnN0ZWFkIG9mIHRoZSBhbWJpZW50IHRlbmFudC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICovXG4gIHN0YXRpYyBnZXREYXRhYmFzZUlkZW50aWZpZXIoe2VuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlID0gdHJ1ZSwgdGVuYW50ID0gQ3VycmVudC50ZW5hbnQoKSwgLi4ucmVzdEFyZ3N9ID0ge30pIHtcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuXG4gICAgY29uc3QgdGVuYW50RGF0YWJhc2VJZGVudGlmaWVyID0gdGhpcy5nZXRUZW5hbnREYXRhYmFzZUlkZW50aWZpZXIodGVuYW50KVxuXG4gICAgaWYgKHRlbmFudERhdGFiYXNlSWRlbnRpZmllcikge1xuICAgICAgaWYgKFxuICAgICAgICBlbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZSAmJlxuICAgICAgICB0aGlzLl9nZXRDb25maWd1cmF0aW9uKCkuZ2V0RW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGVzKCkgJiZcbiAgICAgICAgIXRoaXMuX2dldENvbmZpZ3VyYXRpb24oKS5pc0RhdGFiYXNlSWRlbnRpZmllckFjdGl2ZSh0ZW5hbnREYXRhYmFzZUlkZW50aWZpZXIsIHRlbmFudClcbiAgICAgICkge1xuICAgICAgICB0aHJvdyBuZXcgVGVuYW50RGF0YWJhc2VTY29wZUVycm9yKFxuICAgICAgICAgIGAke3RoaXMuZ2V0TW9kZWxOYW1lKCl9IHJlc29sdmVkIHRlbmFudCBkYXRhYmFzZSBpZGVudGlmaWVyICR7SlNPTi5zdHJpbmdpZnkodGVuYW50RGF0YWJhc2VJZGVudGlmaWVyKX0gYnV0IHRoYXQgZGF0YWJhc2UgaWRlbnRpZmllciBpcyBub3QgYWN0aXZlIGZvciB0aGUgY3VycmVudCB0ZW5hbnQuIFdyYXAgdGhlIG1vZGVsIHF1ZXJ5IGluIGNvbmZpZ3VyYXRpb24ucnVuV2l0aFRlbmFudCguLi4pIG9yIHNldCBlbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZXM6IGZhbHNlIHRvIGFsbG93IGxlZ2FjeSBmYWxsYmFjayBiZWhhdmlvci5gLFxuICAgICAgICAgIHttb2RlbE5hbWU6IHRoaXMuZ2V0TW9kZWxOYW1lKCl9XG4gICAgICAgIClcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHRlbmFudERhdGFiYXNlSWRlbnRpZmllclxuICAgIH1cblxuICAgIGlmIChlbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZSAmJiB0aGlzLl90ZW5hbnREYXRhYmFzZUlkZW50aWZpZXJSZXNvbHZlciAmJiB0aGlzLl9nZXRDb25maWd1cmF0aW9uKCkuZ2V0RW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGVzKCkpIHtcbiAgICAgIHRocm93IG5ldyBUZW5hbnREYXRhYmFzZVNjb3BlRXJyb3IoXG4gICAgICAgIGAke3RoaXMuZ2V0TW9kZWxOYW1lKCl9IGlzIGNvbmZpZ3VyZWQgd2l0aCBzd2l0Y2hlc1RlbmFudERhdGFiYXNlKC4uLikgYnV0IG5vIHRlbmFudCBkYXRhYmFzZSBpZGVudGlmaWVyIHJlc29sdmVkIGZvciB0aGUgY3VycmVudCB0ZW5hbnQuIFdyYXAgdGhlIG1vZGVsIHF1ZXJ5IGluIGNvbmZpZ3VyYXRpb24ucnVuV2l0aFRlbmFudCguLi4pIG9yIHNldCBlbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZXM6IGZhbHNlIHRvIGFsbG93IGxlZ2FjeSBmYWxsYmFjayBiZWhhdmlvci5gLFxuICAgICAgICB7bW9kZWxOYW1lOiB0aGlzLmdldE1vZGVsTmFtZSgpfVxuICAgICAgKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLmdldENvbmZpZ3VyZWREYXRhYmFzZUlkZW50aWZpZXIoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkYXRhYmFzZUlkZW50aWZpZXIgLSBEYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgc2V0RGF0YWJhc2VJZGVudGlmaWVyKGRhdGFiYXNlSWRlbnRpZmllcikge1xuICAgIHRoaXMuX2RhdGFiYXNlSWRlbnRpZmllciA9IGRhdGFiYXNlSWRlbnRpZmllclxuICB9XG5cbiAgLyoqXG4gICAqIERlY2xhcmVzIGEgdGVuYW50LWF3YXJlIGRhdGFiYXNlIGlkZW50aWZpZXIgcmVzb2x2ZXIgZm9yIHRoaXMgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgKChhcmdzOiB7bW9kZWxDbGFzczogdHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkLCB0ZW5hbnQ6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgbnVsbCB8IHVuZGVmaW5lZH0pID0+IHN0cmluZyB8IHVuZGVmaW5lZCl9IGRhdGFiYXNlSWRlbnRpZmllck9yUmVzb2x2ZXIgLSBTdGF0aWMgaWRlbnRpZmllciBvciByZXNvbHZlci5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIHN3aXRjaGVzVGVuYW50RGF0YWJhc2UoZGF0YWJhc2VJZGVudGlmaWVyT3JSZXNvbHZlcikge1xuICAgIHRoaXMuX3RlbmFudERhdGFiYXNlSWRlbnRpZmllclJlc29sdmVyID0gZGF0YWJhc2VJZGVudGlmaWVyT3JSZXNvbHZlclxuXG4gICAgaWYgKHRoaXMuX3RyYW5zbGF0aW9uQ2xhc3MpIHtcbiAgICAgIGNvbnN0IHRyYW5zbGF0ZWRNb2RlbENsYXNzID0gdGhpc1xuXG4gICAgICB0aGlzLl90cmFuc2xhdGlvbkNsYXNzLnN3aXRjaGVzVGVuYW50RGF0YWJhc2UoKHt0ZW5hbnR9KSA9PiB0cmFuc2xhdGVkTW9kZWxDbGFzcy5nZXRUZW5hbnREYXRhYmFzZUlkZW50aWZpZXIodGVuYW50KSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYXMgdGVuYW50IGRhdGFiYXNlIGlkZW50aWZpZXIgcmVzb2x2ZXIuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhpcyBtb2RlbCByZXNvbHZlcyBpdHMgZGF0YWJhc2UgZnJvbSB0aGUgY3VycmVudCB0ZW5hbnQuXG4gICAqL1xuICBzdGF0aWMgaGFzVGVuYW50RGF0YWJhc2VJZGVudGlmaWVyUmVzb2x2ZXIoKSB7XG4gICAgcmV0dXJuIEJvb2xlYW4odGhpcy5fdGVuYW50RGF0YWJhc2VJZGVudGlmaWVyUmVzb2x2ZXIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGVuYW50IGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IFt0ZW5hbnRdIC0gVGVuYW50IG92ZXJyaWRlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIFRlbmFudC1zY29wZWQgZGF0YWJhc2UgaWRlbnRpZmllciB3aGVuIGNvbmZpZ3VyZWQuXG4gICAqL1xuICBzdGF0aWMgZ2V0VGVuYW50RGF0YWJhc2VJZGVudGlmaWVyKHRlbmFudCA9IEN1cnJlbnQudGVuYW50KCkpIHtcbiAgICBjb25zdCB0ZW5hbnREYXRhYmFzZUlkZW50aWZpZXJSZXNvbHZlciA9IHRoaXMuX3RlbmFudERhdGFiYXNlSWRlbnRpZmllclJlc29sdmVyXG5cbiAgICBpZiAoIXRlbmFudERhdGFiYXNlSWRlbnRpZmllclJlc29sdmVyKSB7XG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIHRlbmFudERhdGFiYXNlSWRlbnRpZmllclJlc29sdmVyID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHJldHVybiB0ZW5hbnREYXRhYmFzZUlkZW50aWZpZXJSZXNvbHZlcih7XG4gICAgICAgIG1vZGVsQ2xhc3M6IHRoaXMsXG4gICAgICAgIHRlbmFudFxuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gdGVuYW50RGF0YWJhc2VJZGVudGlmaWVyUmVzb2x2ZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBhdHRyaWJ1dGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTmFtZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIFRoZSBhdHRyaWJ1dGUuXG4gICAqL1xuICBnZXRBdHRyaWJ1dGUobmFtZSkge1xuICAgIGNvbnN0IGNvbHVtbk5hbWUgPSBpbmZsZWN0aW9uLnVuZGVyc2NvcmUobmFtZSlcblxuICAgIGlmICghdGhpcy5pc05ld1JlY29yZCgpICYmICEoY29sdW1uTmFtZSBpbiB0aGlzLl9hdHRyaWJ1dGVzKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMuY29uc3RydWN0b3IubmFtZX0jJHtuYW1lfSBhdHRyaWJ1dGUgaGFzbid0IGJlZW4gbG9hZGVkIHlldCBpbiAke09iamVjdC5rZXlzKHRoaXMuX2F0dHJpYnV0ZXMpLmpvaW4oXCIsIFwiKX1gKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9hdHRyaWJ1dGVzW2NvbHVtbk5hbWVdXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbW9kZWwgY2xhc3MuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcmV0dXJucyB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSAtIFRoZSBtb2RlbCBjbGFzcy5cbiAgICovXG4gIGdldE1vZGVsQ2xhc3MoKSB7XG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSAqLyAodGhpcy5jb25zdHJ1Y3RvcilcblxuICAgIGlmICh0aGlzLl9kYXRhYmFzZU9wZXJhdGlvbikgcmV0dXJuIHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uLm1vZGVsQ2xhc3MobW9kZWxDbGFzcylcblxuICAgIHJldHVybiBtb2RlbENsYXNzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgYXR0cmlidXRlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIE5hbWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IG5ld1ZhbHVlIC0gTmV3IHZhbHVlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzZXRBdHRyaWJ1dGUobmFtZSwgbmV3VmFsdWUpIHtcbiAgICAvLyBSZXNvbHZlIHJhdyBjb2x1bW4gbmFtZXMgKFwiVkFfw5xiQXR0cmlidXRJRFwiLCBcIklQXCIpIGFuZCBjYXNpbmcgdmFyaWFudHMgKFwidkFGdW5rdGlvbklEXCIpIHRvIHRoZVxuICAgIC8vIGNhbm9uaWNhbCBhdHRyaWJ1dGUgdGhlIG1vZGVsIGJhc2UgZ2VuZXJhdGVzIGl0cyBzZXR0ZXIgZnJvbSAoc2V0VkFVZWJhdHRyaWJ1dGlkLCBzZXRJcCwg4oCmKS5cbiAgICBjb25zdCBjYW5vbmljYWxOYW1lID0gdGhpcy5nZXRNb2RlbENsYXNzKCkucmVzb2x2ZUF0dHJpYnV0ZU5hbWUobmFtZSkgPz8gbmFtZVxuICAgIGNvbnN0IHJlcXVlc3RlZFNldHRlck5hbWUgPSBgc2V0JHtpbmZsZWN0aW9uLmNhbWVsaXplKGNhbm9uaWNhbE5hbWUpfWBcbiAgICBjb25zdCBzZXR0ZXJOYW1lID0gdGhpcy5nZXRNb2RlbENsYXNzKCkuZmluZE1lbWJlck5hbWVJbnNlbnNpdGl2ZSh0aGlzLCByZXF1ZXN0ZWRTZXR0ZXJOYW1lKVxuICAgIGNvbnN0IGR5bmFtaWNUaGlzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCAodmFsdWU6IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+KSA9PiB2b2lkPn0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSlcblxuICAgIHRoaXMuZ2V0TW9kZWxDbGFzcygpLl9hc3NlcnRIYXNCZWVuSW5pdGlhbGl6ZWQoKVxuICAgIGlmICghdGhpcy5nZXRNb2RlbENsYXNzKCkuaXNJbml0aWFsaXplZCgpKSB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfSBtb2RlbCBpc24ndCBpbml0aWFsaXplZCB5ZXRgKVxuICAgIGlmICghc2V0dGVyTmFtZSkgdGhyb3cgbmV3IEVycm9yKGBObyBzdWNoIHNldHRlciBtZXRob2Q6ICR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfSMke3JlcXVlc3RlZFNldHRlck5hbWV9YClcblxuICAgIGR5bmFtaWNUaGlzW3NldHRlck5hbWVdKG5ld1ZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGNvbHVtbiBhdHRyaWJ1dGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTmFtZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gbmV3VmFsdWUgLSBOZXcgdmFsdWUuXG4gICAqL1xuICBfc2V0Q29sdW1uQXR0cmlidXRlKG5hbWUsIG5ld1ZhbHVlKSB7XG4gICAgdGhpcy5nZXRNb2RlbENsYXNzKCkuX2Fzc2VydEhhc0JlZW5Jbml0aWFsaXplZCgpXG4gICAgaWYgKCF0aGlzLmdldE1vZGVsQ2xhc3MoKS5fYXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZSkgdGhyb3cgbmV3IEVycm9yKFwiTm8gYXR0cmlidXRlLXRvLWNvbHVtbiBtYXBwaW5nLiBIYXMgcmVjb3JkIGJlZW4gaW5pdGlhbGl6ZWQ/XCIpXG5cbiAgICBjb25zdCByZXNvbHZlZE5hbWUgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5yZXNvbHZlQXR0cmlidXRlTmFtZShuYW1lKVxuICAgIGNvbnN0IGNvbHVtbk5hbWUgPSByZXNvbHZlZE5hbWUgPyB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRBdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwKClbcmVzb2x2ZWROYW1lXSA6IHVuZGVmaW5lZFxuXG4gICAgaWYgKCFjb2x1bW5OYW1lKSB0aHJvdyBuZXcgRXJyb3IoYENvdWxkbid0IGZpZ3VyZSBvdXQgY29sdW1uIG5hbWUgZm9yIGF0dHJpYnV0ZTogJHtuYW1lfWApXG5cbiAgICBsZXQgbm9ybWFsaXplZFZhbHVlID0gbmV3VmFsdWVcbiAgICBjb25zdCBjb2x1bW5UeXBlID0gdGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0Q29sdW1uVHlwZUJ5TmFtZShjb2x1bW5OYW1lKVxuXG4gICAgaWYgKGNvbHVtblR5cGUgJiYgdGhpcy5nZXRNb2RlbENsYXNzKCkuX2lzRGF0ZUxpa2VUeXBlKGNvbHVtblR5cGUpKSB7XG4gICAgICBub3JtYWxpemVkVmFsdWUgPSB0aGlzLl9ub3JtYWxpemVEYXRlVmFsdWUobmV3VmFsdWUpXG4gICAgfVxuXG4gICAgbm9ybWFsaXplZFZhbHVlID0gdGhpcy5fbm9ybWFsaXplQm9vbGVhblZhbHVlRm9yV3JpdGUoe2F0dHJpYnV0ZU5hbWU6IG5hbWUsIGNvbHVtblR5cGUsIHZhbHVlOiBub3JtYWxpemVkVmFsdWV9KVxuXG4gICAgaWYgKHRoaXMuX2F0dHJpYnV0ZXNbY29sdW1uTmFtZV0gIT0gbm9ybWFsaXplZFZhbHVlKSB7XG4gICAgICB0aGlzLl9jbGVhckJlbG9uZ3NUb1JlbGF0aW9uc2hpcEZvckNoYW5nZWRGb3JlaWduS2V5KGNvbHVtbk5hbWUsIG5vcm1hbGl6ZWRWYWx1ZSlcbiAgICAgIHRoaXMuX2NoYW5nZXNbY29sdW1uTmFtZV0gPSBub3JtYWxpemVkVmFsdWVcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ2xlYXJzIGxvYWRlZCBiZWxvbmdzLXRvIGNhY2hlcyB3aGVuIGNhbGxlcnMgYXNzaWduIHRoZSBmb3JlaWduIGtleSBkaXJlY3RseS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbHVtbk5hbWUgLSBDaGFuZ2VkIGRhdGFiYXNlIGNvbHVtbiBuYW1lLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBub3JtYWxpemVkVmFsdWUgLSBOZXcgbm9ybWFsaXplZCBjb2x1bW4gdmFsdWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9jbGVhckJlbG9uZ3NUb1JlbGF0aW9uc2hpcEZvckNoYW5nZWRGb3JlaWduS2V5KGNvbHVtbk5hbWUsIG5vcm1hbGl6ZWRWYWx1ZSkge1xuICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwIG9mIHRoaXMuX2JlbG9uZ3NUb1JlbGF0aW9uc2hpcHNGb3JGb3JlaWduS2V5KGNvbHVtbk5hbWUpKSB7XG4gICAgICBpZiAodGhpcy5fYmVsb25nc1RvUmVsYXRpb25zaGlwTWF0Y2hlc0ZvcmVpZ25LZXlWYWx1ZSh7bm9ybWFsaXplZFZhbHVlLCByZWxhdGlvbnNoaXB9KSkgY29udGludWVcblxuICAgICAgdGhpcy5fY2xlYXJMb2FkZWRCZWxvbmdzVG9SZWxhdGlvbnNoaXAocmVsYXRpb25zaGlwKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJlbG9uZ3MgdG8gcmVsYXRpb25zaGlwcyBmb3IgZm9yZWlnbiBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb2x1bW5OYW1lIC0gQ2hhbmdlZCBkYXRhYmFzZSBjb2x1bW4gbmFtZS5cbiAgICogQHJldHVybnMge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBMb2FkZWQgcmVsYXRpb25zaGlwIGluc3RhbmNlcyB0aGF0IHVzZSB0aGUgY2hhbmdlZCBmb3JlaWduIGtleS5cbiAgICovXG4gIF9iZWxvbmdzVG9SZWxhdGlvbnNoaXBzRm9yRm9yZWlnbktleShjb2x1bW5OYW1lKSB7XG4gICAgaWYgKCF0aGlzLl9pbnN0YW5jZVJlbGF0aW9uc2hpcHMpIHJldHVybiBbXVxuXG4gICAgcmV0dXJuIE9iamVjdFxuICAgICAgLnZhbHVlcyh0aGlzLl9pbnN0YW5jZVJlbGF0aW9uc2hpcHMpXG4gICAgICAuZmlsdGVyKChyZWxhdGlvbnNoaXApID0+IHRoaXMuX2JlbG9uZ3NUb1JlbGF0aW9uc2hpcFVzZXNGb3JlaWduS2V5KHtjb2x1bW5OYW1lLCByZWxhdGlvbnNoaXB9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJlbG9uZ3MgdG8gcmVsYXRpb25zaGlwIHVzZXMgZm9yZWlnbiBrZXkuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUmVsYXRpb25zaGlwIG1hdGNoIGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY29sdW1uTmFtZSAtIENoYW5nZWQgZGF0YWJhc2UgY29sdW1uIG5hbWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MucmVsYXRpb25zaGlwIC0gUmVsYXRpb25zaGlwIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSByZWxhdGlvbnNoaXAgaXMgYSBiZWxvbmdzLXRvIHVzaW5nIHRoZSBjaGFuZ2VkIGZvcmVpZ24ga2V5LlxuICAgKi9cbiAgX2JlbG9uZ3NUb1JlbGF0aW9uc2hpcFVzZXNGb3JlaWduS2V5KHtjb2x1bW5OYW1lLCByZWxhdGlvbnNoaXB9KSB7XG4gICAgaWYgKHJlbGF0aW9uc2hpcC5nZXRUeXBlKCkgIT0gXCJiZWxvbmdzVG9cIikgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCBmb3JlaWduS2V5ID0gcmVsYXRpb25zaGlwLmdldEZvcmVpZ25LZXkoKVxuICAgIGNvbnN0IGZvcmVpZ25LZXlBdHRyaWJ1dGUgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKClbZm9yZWlnbktleV1cblxuICAgIHJldHVybiBmb3JlaWduS2V5ID09IGNvbHVtbk5hbWUgfHwgZm9yZWlnbktleUF0dHJpYnV0ZSA9PSBjb2x1bW5OYW1lXG4gIH1cblxuICAvKipcbiAgICogUnVucyBiZWxvbmdzIHRvIHJlbGF0aW9uc2hpcCBtYXRjaGVzIGZvcmVpZ24ga2V5IHZhbHVlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFJlbGF0aW9uc2hpcCBjYWNoZSBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3Mubm9ybWFsaXplZFZhbHVlIC0gTmV3IG5vcm1hbGl6ZWQgY29sdW1uIHZhbHVlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnJlbGF0aW9uc2hpcCAtIFJlbGF0aW9uc2hpcCBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgbG9hZGVkIHJlbGF0ZWQgcmVjb3JkIHN0aWxsIG1hdGNoZXMgdGhlIGNoYW5nZWQgZm9yZWlnbiBrZXkuXG4gICAqL1xuICBfYmVsb25nc1RvUmVsYXRpb25zaGlwTWF0Y2hlc0ZvcmVpZ25LZXlWYWx1ZSh7bm9ybWFsaXplZFZhbHVlLCByZWxhdGlvbnNoaXB9KSB7XG4gICAgY29uc3QgbG9hZGVkID0gcmVsYXRpb25zaGlwLmdldExvYWRlZE9yVW5kZWZpbmVkKClcblxuICAgIGlmICghbG9hZGVkKSByZXR1cm4gZmFsc2VcbiAgICBpZiAoQXJyYXkuaXNBcnJheShsb2FkZWQpKSByZXR1cm4gZmFsc2VcbiAgICBpZiAoIXJlbGF0aW9uc2hpcC5nZXRUYXJnZXRNb2RlbENsYXNzKCkpIHJldHVybiBmYWxzZVxuXG4gICAgcmV0dXJuIGxvYWRlZC5yZWFkQ29sdW1uKHJlbGF0aW9uc2hpcC5nZXRQcmltYXJ5S2V5KCkpID09IG5vcm1hbGl6ZWRWYWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGZvcmVpZ24ga2V5IHZhbHVlIGZvciBhIGJlbG9uZ3MtdG8gcmVsYXRpb25zaGlwIGFzc2lnbm1lbnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUmVsYXRpb25zaGlwIGFzc2lnbm1lbnQgYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge1ZlbG9jaW91c0RhdGFiYXNlUmVjb3JkIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy5tb2RlbCAtIEFzc2lnbmVkIG1vZGVsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaW5zdGFuY2UtcmVsYXRpb25zaGlwcy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MucmVsYXRpb25zaGlwIC0gQmVsb25ncy10byByZWxhdGlvbnNoaXAgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkfSAtIEZvcmVpZ24ga2V5IHZhbHVlIGZvciB0aGUgYXNzaWdubWVudC5cbiAgICovXG4gIF9iZWxvbmdzVG9Gb3JlaWduS2V5VmFsdWUoe21vZGVsLCByZWxhdGlvbnNoaXB9KSB7XG4gICAgaWYgKG1vZGVsID09IG51bGwpIHJldHVybiBudWxsXG4gICAgaWYgKCEobW9kZWwgaW5zdGFuY2VvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZCkpIHRocm93IG5ldyBFcnJvcihgVW5leHBlY3RlZCBtb2RlbCB0eXBlOiAke3R5cGVvZiBtb2RlbH1gKVxuXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7c3RyaW5nIHwgbnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZH0gKi8gKG1vZGVsLnJlYWRDb2x1bW4ocmVsYXRpb25zaGlwLmdldFByaW1hcnlLZXkoKSkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjbGVhciBsb2FkZWQgYmVsb25ncyB0byByZWxhdGlvbnNoaXAuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHJlbGF0aW9uc2hpcCAtIFJlbGF0aW9uc2hpcCBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX2NsZWFyTG9hZGVkQmVsb25nc1RvUmVsYXRpb25zaGlwKHJlbGF0aW9uc2hpcCkge1xuICAgIHJlbGF0aW9uc2hpcC5zZXRMb2FkZWQodW5kZWZpbmVkKVxuICAgIHJlbGF0aW9uc2hpcC5zZXRQcmVsb2FkZWQoZmFsc2UpXG4gICAgcmVsYXRpb25zaGlwLnNldERpcnR5KGZhbHNlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIGRhdGUgdmFsdWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUgdG8gdXNlLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gVGhlIGRhdGUgdmFsdWUuXG4gICAqL1xuICBfbm9ybWFsaXplRGF0ZVZhbHVlKHZhbHVlKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZURhdGVWYWx1ZUZvcldyaXRlKHZhbHVlLCB7dGltZVpvbmU6IHRoaXMuZ2V0TW9kZWxDbGFzcygpLl90aW1lWm9uZUZvckRhdGVXcml0ZSgpfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBzcWxpdGUgYm9vbGVhbiB2YWx1ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IGFyZ3MuY29sdW1uVHlwZSAtIENvbHVtbiB0eXBlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnZhbHVlIC0gVmFsdWUgdG8gbm9ybWFsaXplLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gTm9ybWFsaXplZCB2YWx1ZS5cbiAgICovXG4gIF9ub3JtYWxpemVTcWxpdGVCb29sZWFuVmFsdWUoe2NvbHVtblR5cGUsIHZhbHVlfSkge1xuICAgIGlmICh0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXREYXRhYmFzZVR5cGUoKSAhPSBcInNxbGl0ZVwiKSByZXR1cm4gdmFsdWVcbiAgICBpZiAoIWNvbHVtblR5cGUpIHJldHVybiB2YWx1ZVxuICAgIGlmIChjb2x1bW5UeXBlLnRvTG93ZXJDYXNlKCkgIT09IFwiYm9vbGVhblwiKSByZXR1cm4gdmFsdWVcbiAgICBpZiAodmFsdWUgPT09IHRydWUpIHJldHVybiAxXG4gICAgaWYgKHZhbHVlID09PSBmYWxzZSkgcmV0dXJuIDBcblxuICAgIHJldHVybiB2YWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIE5vcm1hbGl6ZXMgYSBib29sZWFuIHZhbHVlIGJlZm9yZSBzdG9yaW5nLiBBIGRlY2xhcmVkIGBcImJvb2xlYW5cImAgYXR0cmlidXRlIGNhc3Qgc3RvcmVzXG4gICAqIGJvb2xlYW5zIGFzIDEvMCBvbmx5IGZvciBpbnRlZ2VyLWJhY2tlZCBjb2x1bW5zIChlLmcuIGFuIE1TU1FMIGBiaXRgKS4gQ29sdW1ucyB3aG9zZVxuICAgKiB1bmRlcmx5aW5nIHR5cGUgaXMgYWxyZWFkeSBhIG5hdGl2ZSBib29sZWFuIChlLmcuIFBvc3RncmVzIGBib29sZWFuYCkga2VlcCBgdHJ1ZWAvYGZhbHNlYFxuICAgKiBzbyB0aGUgZHJpdmVyIGNhbiBlbWl0IHRoZSBwcm9wZXIgYm9vbGVhbiBsaXRlcmFsOyBvdGhlcndpc2UgdGhlIHNxbGl0ZS1vbmx5IG5vcm1hbGl6ZXIgYXBwbGllcy5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lIGJlaW5nIHdyaXR0ZW4uXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBhcmdzLmNvbHVtblR5cGUgLSBDb2x1bW4gdHlwZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy52YWx1ZSAtIFZhbHVlIHRvIG5vcm1hbGl6ZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIE5vcm1hbGl6ZWQgdmFsdWUuXG4gICAqL1xuICBfbm9ybWFsaXplQm9vbGVhblZhbHVlRm9yV3JpdGUoe2F0dHJpYnV0ZU5hbWUsIGNvbHVtblR5cGUsIHZhbHVlfSkge1xuICAgIGlmICghdGhpcy5nZXRNb2RlbENsYXNzKCkuX2RlY2xhcmVkQm9vbGVhblN0b3Jlc0FzSW50ZWdlcihhdHRyaWJ1dGVOYW1lKSkge1xuICAgICAgcmV0dXJuIHRoaXMuX25vcm1hbGl6ZVNxbGl0ZUJvb2xlYW5WYWx1ZSh7Y29sdW1uVHlwZSwgdmFsdWV9KVxuICAgIH1cblxuICAgIGlmICh2YWx1ZSA9PT0gdHJ1ZSkgcmV0dXJuIDFcbiAgICBpZiAodmFsdWUgPT09IGZhbHNlKSByZXR1cm4gMFxuXG4gICAgcmV0dXJuIHZhbHVlXG4gIH1cblxuICAvKipcbiAgICogV2hldGhlciBhIGRlY2xhcmVkIGBcImJvb2xlYW5cImAgYXR0cmlidXRlIGNhc3QgaXMgYmFja2VkIGJ5IGFuIGludGVnZXIgY29sdW1uIChlLmcuIGFuIE1TU1FMXG4gICAqIGBiaXRgKSwgc28gYm9vbGVhbnMgbXVzdCBiZSBzdG9yZWQgYXMgMS8wLiBBIG5hdGl2ZSBib29sZWFuIGNvbHVtbiAoZS5nLiBQb3N0Z3JlcyBgYm9vbGVhbmApXG4gICAqIHJldHVybnMgZmFsc2UgYW5kIGtlZXBzIGB0cnVlYC9gZmFsc2VgIGZvciB0aGUgZHJpdmVyLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBkZWNsYXJlZCBib29sZWFuIGlzIHN0b3JlZCBhcyBhbiBpbnRlZ2VyLlxuICAgKi9cbiAgc3RhdGljIF9kZWNsYXJlZEJvb2xlYW5TdG9yZXNBc0ludGVnZXIoYXR0cmlidXRlTmFtZSkge1xuICAgIGlmICh0aGlzLmdldEF0dHJpYnV0ZUNhc3QoYXR0cmlidXRlTmFtZSkgIT09IFwiYm9vbGVhblwiKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IGNvbHVtbk5hbWUgPSB0aGlzLmdldEF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXAoKVthdHRyaWJ1dGVOYW1lXVxuICAgIGNvbnN0IGludHJvc3BlY3RlZFR5cGUgPSBjb2x1bW5OYW1lID8gdGhpcy5nZXRDb2x1bW5zSGFzaCgpW2NvbHVtbk5hbWVdPy5nZXRUeXBlKCkgOiB1bmRlZmluZWRcblxuICAgIHJldHVybiB0eXBlb2YgaW50cm9zcGVjdGVkVHlwZSA9PT0gXCJzdHJpbmdcIiAmJiBpbnRyb3NwZWN0ZWRUeXBlLnRvTG93ZXJDYXNlKCkgIT09IFwiYm9vbGVhblwiXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY29sdW1ucy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS1jb2x1bW4uanNcIikuZGVmYXVsdFtdfSAtIFRoZSBjb2x1bW5zLlxuICAgKi9cbiAgc3RhdGljIGdldENvbHVtbnMoKSB7XG4gICAgdGhpcy5fYXNzZXJ0SGFzQmVlbkluaXRpYWxpemVkKClcbiAgICBpZiAoIXRoaXMuX2NvbHVtbnMpIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLm5hbWV9IGhhc24ndCBiZWVuIGluaXRpYWxpemVkIHlldGApXG5cbiAgICByZXR1cm4gdGhpcy5fY29sdW1uc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGNvbHVtbnMgaGFzaC5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS1jb2x1bW4uanNcIikuZGVmYXVsdD59IC0gVGhlIGNvbHVtbnMgaGFzaC5cbiAgICovXG4gIHN0YXRpYyBnZXRDb2x1bW5zSGFzaCgpIHtcbiAgICBpZiAoIXRoaXMuX2NvbHVtbnNBc0hhc2gpIHtcbiAgICAgIC8qKlxuICAgICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS1jb2x1bW4uanNcIikuZGVmYXVsdD59ICovXG4gICAgICB0aGlzLl9jb2x1bW5zQXNIYXNoID0ge31cblxuICAgICAgZm9yIChjb25zdCBjb2x1bW4gb2YgdGhpcy5nZXRDb2x1bW5zKCkpIHtcbiAgICAgICAgdGhpcy5fY29sdW1uc0FzSGFzaFtjb2x1bW4uZ2V0TmFtZSgpXSA9IGNvbHVtblxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9jb2x1bW5zQXNIYXNoXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY29sdW1uIHR5cGUgYnkgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBOYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIFRoZSBjb2x1bW4gdHlwZSBieSBuYW1lLlxuICAgKi9cbiAgc3RhdGljIGdldENvbHVtblR5cGVCeU5hbWUobmFtZSkge1xuICAgIGlmICghdGhpcy5fY29sdW1uVHlwZUJ5TmFtZSkge1xuICAgICAgLyoqXG4gICAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgdW5kZWZpbmVkPn0gKi9cbiAgICAgIHRoaXMuX2NvbHVtblR5cGVCeU5hbWUgPSB7fVxuXG4gICAgICBmb3IgKGNvbnN0IGNvbHVtbiBvZiB0aGlzLmdldENvbHVtbnMoKSkge1xuICAgICAgICB0aGlzLl9jb2x1bW5UeXBlQnlOYW1lW2NvbHVtbi5nZXROYW1lKCldID0gY29sdW1uLmdldFR5cGUoKVxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWUgPSB0aGlzLmdldENvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXAoKVtuYW1lXVxuXG4gICAgaWYgKGF0dHJpYnV0ZU5hbWUpIHtcbiAgICAgIGNvbnN0IGNhc3QgPSB0aGlzLmdldEF0dHJpYnV0ZUNhc3QoYXR0cmlidXRlTmFtZSlcblxuICAgICAgaWYgKGNhc3QpIHJldHVybiBjYXN0XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2NvbHVtblR5cGVCeU5hbWVbbmFtZV1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIGRhdGUgbGlrZSB0eXBlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdHlwZSAtIFR5cGUgaWRlbnRpZmllci5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBkYXRlIGxpa2UgdHlwZS5cbiAgICovXG4gIHN0YXRpYyBfaXNEYXRlTGlrZVR5cGUodHlwZSkge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWRUeXBlID0gdHlwZS50b0xvd2VyQ2FzZSgpXG5cbiAgICByZXR1cm4gbm9ybWFsaXplZFR5cGUgPT0gXCJkYXRlXCIgfHxcbiAgICAgIG5vcm1hbGl6ZWRUeXBlID09IFwiZGF0ZXRpbWVcIiB8fFxuICAgICAgbm9ybWFsaXplZFR5cGUgPT0gXCJ0aW1lc3RhbXBcIiB8fFxuICAgICAgbm9ybWFsaXplZFR5cGUgPT0gXCJ0aW1lc3RhbXB0elwiIHx8XG4gICAgICBub3JtYWxpemVkVHlwZS5zdGFydHNXaXRoKFwidGltZXN0YW1wIFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGNvbHVtbiBuYW1lcy5cbiAgICogQHJldHVybnMge0FycmF5PHN0cmluZz59IC0gVGhlIGNvbHVtbiBuYW1lcy5cbiAgICovXG4gIHN0YXRpYyBnZXRDb2x1bW5OYW1lcygpIHtcbiAgICBpZiAoIXRoaXMuX2NvbHVtbk5hbWVzKSB7XG4gICAgICB0aGlzLl9jb2x1bW5OYW1lcyA9IHRoaXMuZ2V0Q29sdW1ucygpLm1hcCgoY29sdW1uKSA9PiBjb2x1bW4uZ2V0TmFtZSgpKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9jb2x1bW5OYW1lc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRhYmxlLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLXRhYmxlLmpzXCIpLmRlZmF1bHR9IC0gVGhlIHRhYmxlLlxuICAgKi9cbiAgc3RhdGljIF9nZXRUYWJsZSgpIHtcbiAgICBpZiAoIXRoaXMuX3RhYmxlKSB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5uYW1lfSBoYXNuJ3QgYmVlbiBpbml0aWFsaXplZCB5ZXRgKVxuXG4gICAgcmV0dXJuIHRoaXMuX3RhYmxlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbnNlcnQgbXVsdGlwbGUuXG4gICAqIEBwYXJhbSB7QXJyYXk8c3RyaW5nPn0gY29sdW1ucyAtIENvbHVtbiBuYW1lcy5cbiAgICogQHBhcmFtIHtBcnJheTxBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSByb3dzIC0gUm93cyB0byBpbnNlcnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbYXJnc10gLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5jYXN0XSAtIFdoZXRoZXIgdG8gY2FzdCB2YWx1ZXMgYmFzZWQgb24gY29sdW1uIHR5cGVzLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLnJldHJ5SW5kaXZpZHVhbGx5T25GYWlsdXJlXSAtIFJldHJ5IHJvd3MgaW5kaXZpZHVhbGx5IGlmIGEgYmF0Y2ggaW5zZXJ0IGZhaWxzLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLnJldHVyblJlc3VsdHNdIC0gUmV0dXJuIHN1Y2NlZWRlZC9mYWlsZWQgcm93cyBpbnN0ZWFkIG9mIHRocm93aW5nIHdoZW4gcmV0cmllcyBmYWlsLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkIHwge3N1Y2NlZWRlZFJvd3M6IEFycmF5PEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj4sIGZhaWxlZFJvd3M6IEFycmF5PEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj4sIGVycm9yczogQXJyYXk8e3JvdzogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBlcnJvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59Pn0+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgaW5zZXJ0TXVsdGlwbGUoY29sdW1ucywgcm93cywgYXJncyA9IHt9KSB7XG4gICAgY29uc3Qge2Nhc3QgPSB0cnVlLCByZXRyeUluZGl2aWR1YWxseU9uRmFpbHVyZSA9IGZhbHNlLCByZXR1cm5SZXN1bHRzID0gZmFsc2UsIC4uLnJlc3RBcmdzfSA9IGFyZ3NcblxuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG4gICAgYXdhaXQgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpXG5cbiAgICBjb25zdCBub3JtYWxpemVkUm93cyA9IGNhc3RcbiAgICAgID8gdGhpcy5fbm9ybWFsaXplSW5zZXJ0TXVsdGlwbGVSb3dzKHtjb2x1bW5zLCByb3dzfSlcbiAgICAgIDogcm93c1xuICAgIGNvbnN0IHRhYmxlTmFtZSA9IHRoaXMudGFibGVOYW1lKClcblxuICAgIGlmICghcmV0cnlJbmRpdmlkdWFsbHlPbkZhaWx1cmUpIHtcbiAgICAgIGF3YWl0IHRoaXMuY29ubmVjdGlvbigpLmluc2VydE11bHRpcGxlKHRhYmxlTmFtZSwgY29sdW1ucywgbm9ybWFsaXplZFJvd3MpXG4gICAgICBpZiAocmV0dXJuUmVzdWx0cykgcmV0dXJuIHtzdWNjZWVkZWRSb3dzOiBub3JtYWxpemVkUm93cy5zbGljZSgpLCBmYWlsZWRSb3dzOiBbXSwgZXJyb3JzOiBbXX1cbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICAvLyBXcmFwIHRoZSBiYXRjaCBpbiBhIHRyYW5zYWN0aW9uL3NhdmVwb2ludC4gT24gZGF0YWJhc2VzIHRoYXQgYWJvcnQgdGhlXG4gICAgICAvLyB3aG9sZSB0cmFuc2FjdGlvbiB3aGVuIGEgc3RhdGVtZW50IGZhaWxzIChQb3N0Z3JlU1FMKSwgYSBmYWlsZWQgYmF0Y2hcbiAgICAgIC8vIHdvdWxkIG90aGVyd2lzZSBwb2lzb24gdGhlIHN1cnJvdW5kaW5nIHRyYW5zYWN0aW9uIHNvIHRoYXQgdGhlXG4gICAgICAvLyBpbmRpdmlkdWFsIHJldHJpZXMgYmVsb3cgYWxsIGZhaWwgd2l0aCBcImN1cnJlbnQgdHJhbnNhY3Rpb24gaXMgYWJvcnRlZFwiLlxuICAgICAgLy8gdHJhbnNhY3Rpb24oKSBvcGVucyBhIHNhdmVwb2ludCB3aGVuIGFscmVhZHkgaW5zaWRlIGEgdHJhbnNhY3Rpb24gYW5kIGFcbiAgICAgIC8vIHJlYWwgdHJhbnNhY3Rpb24gb3RoZXJ3aXNlLCBzbyBhIGZhaWx1cmUgcm9sbHMgYmFjayBvbmx5IHRoaXMgYXR0ZW1wdC5cbiAgICAgIGF3YWl0IHRoaXMuY29ubmVjdGlvbigpLnRyYW5zYWN0aW9uKGFzeW5jICgpID0+IHtcbiAgICAgICAgYXdhaXQgdGhpcy5jb25uZWN0aW9uKCkuaW5zZXJ0TXVsdGlwbGUodGFibGVOYW1lLCBjb2x1bW5zLCBub3JtYWxpemVkUm93cylcbiAgICAgIH0pXG4gICAgICBpZiAocmV0dXJuUmVzdWx0cykgcmV0dXJuIHtzdWNjZWVkZWRSb3dzOiBub3JtYWxpemVkUm93cy5zbGljZSgpLCBmYWlsZWRSb3dzOiBbXSwgZXJyb3JzOiBbXX1cbiAgICAgIHJldHVyblxuICAgIH0gY2F0Y2gge1xuICAgICAgLyoqXG4gICAgICAgKiBSZXN1bHRzLlxuICAgICAgICogQHR5cGUge3tzdWNjZWVkZWRSb3dzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj5bXSwgZmFpbGVkUm93czogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+W10sIGVycm9yczogQXJyYXk8e3JvdzogQXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBlcnJvcjogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59Pn19ICovXG4gICAgICBjb25zdCByZXN1bHRzID0ge1xuICAgICAgICBzdWNjZWVkZWRSb3dzOiBbXSxcbiAgICAgICAgZmFpbGVkUm93czogW10sXG4gICAgICAgIGVycm9yczogW11cbiAgICAgIH1cblxuICAgICAgZm9yIChjb25zdCByb3cgb2Ygbm9ybWFsaXplZFJvd3MpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAvLyBFYWNoIHJldHJ5IHJ1bnMgaW4gaXRzIG93biBzYXZlcG9pbnQgc28gYSBmYWlsZWQgcm93IHJvbGxzIGJhY2sgb25seVxuICAgICAgICAgIC8vIHRoYXQgcm93IGFuZCBsZWF2ZXMgdGhlIHN1cnJvdW5kaW5nIHRyYW5zYWN0aW9uIHVzYWJsZSBmb3IgdGhlIHJlc3QuXG4gICAgICAgICAgYXdhaXQgdGhpcy5jb25uZWN0aW9uKCkudHJhbnNhY3Rpb24oYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5jb25uZWN0aW9uKCkuaW5zZXJ0TXVsdGlwbGUodGFibGVOYW1lLCBjb2x1bW5zLCBbcm93XSlcbiAgICAgICAgICB9KVxuICAgICAgICAgIHJlc3VsdHMuc3VjY2VlZGVkUm93cy5wdXNoKHJvdylcbiAgICAgICAgfSBjYXRjaCAocm93RXJyb3IpIHtcbiAgICAgICAgICByZXN1bHRzLmZhaWxlZFJvd3MucHVzaChyb3cpXG4gICAgICAgICAgcmVzdWx0cy5lcnJvcnMucHVzaCh7cm93LCBlcnJvcjogcm93RXJyb3J9KVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChyZXN1bHRzLmZhaWxlZFJvd3MubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCBjb21iaW5lZEVycm9ycyA9IHJlc3VsdHMuZXJyb3JzLm1hcCgoZW50cnksIGluZGV4KSA9PiB7XG4gICAgICAgICAgY29uc3QgbWVzc2FnZSA9IGVudHJ5LmVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlbnRyeS5lcnJvci5tZXNzYWdlIDogU3RyaW5nKGVudHJ5LmVycm9yKVxuICAgICAgICAgIHJldHVybiBgWyR7aW5kZXh9XSAke21lc3NhZ2V9LiBSb3c6ICR7dGhpcy5fc2FmZVNlcmlhbGl6ZUluc2VydFJvdyhlbnRyeS5yb3cpfWBcbiAgICAgICAgfSkuam9pbihcIiB8IFwiKVxuICAgICAgICBjb25zdCBjb21iaW5lZEVycm9yID0gbmV3IEVycm9yKGBpbnNlcnRNdWx0aXBsZSBmYWlsZWQgZm9yICR7cmVzdWx0cy5mYWlsZWRSb3dzLmxlbmd0aH0gcm93cy4gJHtjb21iaW5lZEVycm9yc31gKVxuXG4gICAgICAgIGlmIChyZXR1cm5SZXN1bHRzKSByZXR1cm4gcmVzdWx0c1xuICAgICAgICB0aHJvdyBjb21iaW5lZEVycm9yXG4gICAgICB9XG5cbiAgICAgIGlmIChyZXR1cm5SZXN1bHRzKSByZXR1cm4gcmVzdWx0c1xuICAgICAgcmV0dXJuXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIGluc2VydCBtdWx0aXBsZSByb3dzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge0FycmF5PHN0cmluZz59IGFyZ3MuY29sdW1ucyAtIENvbHVtbiBuYW1lcy5cbiAgICogQHBhcmFtIHtBcnJheTxBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSBhcmdzLnJvd3MgLSBSb3dzIHRvIGluc2VydC5cbiAgICogQHJldHVybnMge0FycmF5PEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gTm9ybWFsaXplZCByb3dzLlxuICAgKi9cbiAgc3RhdGljIF9ub3JtYWxpemVJbnNlcnRNdWx0aXBsZVJvd3Moe2NvbHVtbnMsIHJvd3N9KSB7XG4gICAgcmV0dXJuIHJvd3MubWFwKChyb3cpID0+IHtcbiAgICAgIGlmICghQXJyYXkuaXNBcnJheShyb3cpIHx8IHJvdy5sZW5ndGggIT09IGNvbHVtbnMubGVuZ3RoKSB7XG4gICAgICAgIGNvbnN0IHJvd0xlbmd0aCA9IEFycmF5LmlzQXJyYXkocm93KSA/IHJvdy5sZW5ndGggOiBcIm5vbi1hcnJheVwiXG5cbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBpbnNlcnRNdWx0aXBsZSByb3cgbGVuZ3RoIG1pc21hdGNoLiBFeHBlY3RlZCAke2NvbHVtbnMubGVuZ3RofSB2YWx1ZXMgYnV0IGdvdCAke3Jvd0xlbmd0aH0uIFJvdzogJHtKU09OLnN0cmluZ2lmeShyb3cpfWApXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRSb3cgPSBbXVxuXG4gICAgICBmb3IgKGxldCBpbmRleCA9IDA7IGluZGV4IDwgY29sdW1ucy5sZW5ndGg7IGluZGV4KyspIHtcbiAgICAgICAgY29uc3QgY29sdW1uTmFtZSA9IGNvbHVtbnNbaW5kZXhdXG4gICAgICAgIGNvbnN0IHZhbHVlID0gcm93W2luZGV4XVxuXG4gICAgICAgIG5vcm1hbGl6ZWRSb3dbaW5kZXhdID0gdGhpcy5fbm9ybWFsaXplSW5zZXJ0VmFsdWVGb3JDb2x1bW4oe2NvbHVtbk5hbWUsIHZhbHVlfSlcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIG5vcm1hbGl6ZWRSb3dcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2FmZSBzZXJpYWxpemUgaW5zZXJ0IHJvdy5cbiAgICogQHBhcmFtIHtBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHJvdyAtIFJvdyB0byBzZXJpYWxpemUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU2FmZSByb3cgcmVwcmVzZW50YXRpb24uXG4gICAqL1xuICBzdGF0aWMgX3NhZmVTZXJpYWxpemVJbnNlcnRSb3cocm93KSB7XG4gICAgcmV0dXJuIGZvcm1hdFZhbHVlKHJvdylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBpbnNlcnQgdmFsdWUgZm9yIGNvbHVtbi5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY29sdW1uTmFtZSAtIENvbHVtbiBuYW1lLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnZhbHVlIC0gQ29sdW1uIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gTm9ybWFsaXplZCB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBfbm9ybWFsaXplSW5zZXJ0VmFsdWVGb3JDb2x1bW4oe2NvbHVtbk5hbWUsIHZhbHVlfSkge1xuICAgIGNvbnN0IGNvbHVtbiA9IHRoaXMuZ2V0Q29sdW1uc0hhc2goKVtjb2x1bW5OYW1lXVxuXG4gICAgaWYgKCFjb2x1bW4pIHJldHVybiB2YWx1ZVxuXG4gICAgY29uc3QgY29sdW1uVHlwZSA9IGNvbHVtbi5nZXRUeXBlKClcbiAgICBjb25zdCBub3JtYWxpemVkVHlwZSA9IHR5cGVvZiBjb2x1bW5UeXBlID09PSBcInN0cmluZ1wiID8gY29sdW1uVHlwZS50b0xvd2VyQ2FzZSgpIDogdW5kZWZpbmVkXG4gICAgbGV0IG5vcm1hbGl6ZWRWYWx1ZSA9IHZhbHVlXG5cbiAgICBpZiAobm9ybWFsaXplZFR5cGUgJiYgdGhpcy5faXNEYXRlTGlrZVR5cGUobm9ybWFsaXplZFR5cGUpKSB7XG4gICAgICBub3JtYWxpemVkVmFsdWUgPSB0aGlzLl9ub3JtYWxpemVEYXRlVmFsdWVGb3JJbnNlcnQobm9ybWFsaXplZFZhbHVlKVxuICAgIH1cblxuICAgIG5vcm1hbGl6ZWRWYWx1ZSA9IHRoaXMuX25vcm1hbGl6ZVNxbGl0ZUJvb2xlYW5WYWx1ZUZvckluc2VydCh7Y29sdW1uVHlwZSwgdmFsdWU6IG5vcm1hbGl6ZWRWYWx1ZX0pXG5cbiAgICBpZiAobm9ybWFsaXplZFZhbHVlID09PSBcIlwiICYmIGNvbHVtbi5nZXROdWxsKCkgJiYgIXRoaXMuX2lzU3RyaW5nVHlwZShub3JtYWxpemVkVHlwZSkpIHtcbiAgICAgIG5vcm1hbGl6ZWRWYWx1ZSA9IG51bGxcbiAgICB9XG5cbiAgICBpZiAobm9ybWFsaXplZFR5cGUgJiYgdGhpcy5faXNOdW1lcmljVHlwZShub3JtYWxpemVkVHlwZSkpIHtcbiAgICAgIG5vcm1hbGl6ZWRWYWx1ZSA9IHRoaXMuX25vcm1hbGl6ZU51bWVyaWNWYWx1ZSh7Y29sdW1uVHlwZTogbm9ybWFsaXplZFR5cGUsIHZhbHVlOiBub3JtYWxpemVkVmFsdWV9KVxuICAgIH1cblxuICAgIHJldHVybiBub3JtYWxpemVkVmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIHN0cmluZyB0eXBlLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gY29sdW1uVHlwZSAtIENvbHVtbiB0eXBlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHN0cmluZy1saWtlIHR5cGUuXG4gICAqL1xuICBzdGF0aWMgX2lzU3RyaW5nVHlwZShjb2x1bW5UeXBlKSB7XG4gICAgaWYgKCFjb2x1bW5UeXBlKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IHN0cmluZ1R5cGVzID0gbmV3IFNldChbXCJjaGFyXCIsIFwidmFyY2hhclwiLCBcIm52YXJjaGFyXCIsIFwic3RyaW5nXCIsIFwiZW51bVwiLCBcImpzb25cIiwgXCJqc29uYlwiLCBcImNpdGV4dFwiLCBcImJpbmFyeVwiLCBcInZhcmJpbmFyeVwiXSlcblxuICAgIHJldHVybiBjb2x1bW5UeXBlLmluY2x1ZGVzKFwidXVpZFwiKSB8fFxuICAgICAgY29sdW1uVHlwZS5pbmNsdWRlcyhcInRleHRcIikgfHxcbiAgICAgIHN0cmluZ1R5cGVzLmhhcyhjb2x1bW5UeXBlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgbnVtZXJpYyB0eXBlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29sdW1uVHlwZSAtIENvbHVtbiB0eXBlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIG51bWVyaWMtbGlrZSB0eXBlLlxuICAgKi9cbiAgc3RhdGljIF9pc051bWVyaWNUeXBlKGNvbHVtblR5cGUpIHtcbiAgICByZXR1cm4gY29sdW1uVHlwZS5pbmNsdWRlcyhcImludFwiKSB8fFxuICAgICAgY29sdW1uVHlwZS5pbmNsdWRlcyhcImRlY2ltYWxcIikgfHxcbiAgICAgIGNvbHVtblR5cGUuaW5jbHVkZXMoXCJudW1lcmljXCIpIHx8XG4gICAgICBjb2x1bW5UeXBlLmluY2x1ZGVzKFwiZmxvYXRcIikgfHxcbiAgICAgIGNvbHVtblR5cGUuaW5jbHVkZXMoXCJkb3VibGVcIikgfHxcbiAgICAgIGNvbHVtblR5cGUuaW5jbHVkZXMoXCJyZWFsXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgbnVtZXJpYyB2YWx1ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY29sdW1uVHlwZSAtIENvbHVtbiB0eXBlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnZhbHVlIC0gVmFsdWUgdG8gbm9ybWFsaXplLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gTm9ybWFsaXplZCB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBfbm9ybWFsaXplTnVtZXJpY1ZhbHVlKHtjb2x1bW5UeXBlLCB2YWx1ZX0pIHtcbiAgICBpZiAodmFsdWUgPT09IFwiXCIgfHwgdmFsdWUgPT09IG51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHZhbHVlXG4gICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gXCJzdHJpbmdcIikgcmV0dXJuIHZhbHVlXG5cbiAgICBpZiAoY29sdW1uVHlwZS5pbmNsdWRlcyhcImRlY2ltYWxcIikgfHwgY29sdW1uVHlwZS5pbmNsdWRlcyhcIm51bWVyaWNcIikpIHtcbiAgICAgIHJldHVybiB2YWx1ZVxuICAgIH1cblxuICAgIGNvbnN0IHBhcnNlZCA9IE51bWJlcih2YWx1ZSlcblxuICAgIGlmICghTnVtYmVyLmlzRmluaXRlKHBhcnNlZCkpIHJldHVybiB2YWx1ZVxuXG4gICAgaWYgKGNvbHVtblR5cGUuaW5jbHVkZXMoXCJpbnRcIikpIHtcbiAgICAgIGlmICghTnVtYmVyLmlzU2FmZUludGVnZXIocGFyc2VkKSkgcmV0dXJuIHZhbHVlXG4gICAgICBpZiAoIS9eLT9cXGQrJC8udGVzdCh2YWx1ZSkpIHJldHVybiB2YWx1ZVxuICAgIH1cblxuICAgIHJldHVybiBwYXJzZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBkYXRlIHZhbHVlIGZvciBpbnNlcnQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUgdG8gbm9ybWFsaXplLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gTm9ybWFsaXplZCB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBfbm9ybWFsaXplRGF0ZVZhbHVlRm9ySW5zZXJ0KHZhbHVlKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZURhdGVWYWx1ZUZvcldyaXRlKHZhbHVlLCB7dGltZVpvbmU6IHRoaXMuX3RpbWVab25lRm9yRGF0ZVdyaXRlKCl9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIGRhdGUgc3RyaW5nIGZvciBpbnNlcnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB2YWx1ZSAtIERhdGUgc3RyaW5nIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgRGF0ZX0gLSBQYXJzZWQgZGF0ZSBvciBvcmlnaW5hbCBzdHJpbmcuXG4gICAqL1xuICBzdGF0aWMgX25vcm1hbGl6ZURhdGVTdHJpbmdGb3JJbnNlcnQodmFsdWUpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplRGF0ZVN0cmluZ0ZvcldyaXRlKHZhbHVlLCB7dGltZVpvbmU6IHRoaXMuX3RpbWVab25lRm9yRGF0ZVdyaXRlKCl9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdGltZSB6b25lIGZvciBkYXRlIHdyaXRlcy5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBBY3RpdmUgdGltZXpvbmUgaWRlbnRpZmllci5cbiAgICovXG4gIHN0YXRpYyBfdGltZVpvbmVGb3JEYXRlV3JpdGUoKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuX2dldENvbmZpZ3VyYXRpb24oKVxuXG4gICAgcmV0dXJuIGNvbmZpZ3VyYXRpb24uZ2V0RW52aXJvbm1lbnRIYW5kbGVyKCkuZ2V0VGltZVpvbmUoY29uZmlndXJhdGlvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBzcWxpdGUgYm9vbGVhbiB2YWx1ZSBmb3IgaW5zZXJ0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gYXJncy5jb2x1bW5UeXBlIC0gQ29sdW1uIHR5cGUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MudmFsdWUgLSBWYWx1ZSB0byBub3JtYWxpemUuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBOb3JtYWxpemVkIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIF9ub3JtYWxpemVTcWxpdGVCb29sZWFuVmFsdWVGb3JJbnNlcnQoe2NvbHVtblR5cGUsIHZhbHVlfSkge1xuICAgIGlmICh0aGlzLmdldERhdGFiYXNlVHlwZSgpICE9IFwic3FsaXRlXCIpIHJldHVybiB2YWx1ZVxuICAgIGlmICghY29sdW1uVHlwZSkgcmV0dXJuIHZhbHVlXG4gICAgaWYgKGNvbHVtblR5cGUudG9Mb3dlckNhc2UoKSAhPT0gXCJib29sZWFuXCIpIHJldHVybiB2YWx1ZVxuICAgIGlmICh2YWx1ZSA9PT0gdHJ1ZSkgcmV0dXJuIDFcbiAgICBpZiAodmFsdWUgPT09IGZhbHNlKSByZXR1cm4gMFxuXG4gICAgcmV0dXJuIHZhbHVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBuZXh0IHByaW1hcnkga2V5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIFJlc29sdmVzIHdpdGggdGhlIG5leHQgcHJpbWFyeSBrZXkuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgbmV4dFByaW1hcnlLZXkoKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpXG5cbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gdGhpcy5wcmltYXJ5S2V5KClcbiAgICBjb25zdCB0YWJsZU5hbWUgPSB0aGlzLnRhYmxlTmFtZSgpXG4gICAgY29uc3QgY29ubmVjdGlvbiA9IHRoaXMuY29ubmVjdGlvbigpXG4gICAgY29uc3QgbmV3ZXN0UmVjb3JkID0gYXdhaXQgdGhpcy5vcmRlcihgJHtjb25uZWN0aW9uLnF1b3RlVGFibGUodGFibGVOYW1lKX0uJHtjb25uZWN0aW9uLnF1b3RlQ29sdW1uKHByaW1hcnlLZXkpfWApLmxhc3QoKVxuXG4gICAgaWYgKG5ld2VzdFJlY29yZCkge1xuICAgICAgY29uc3QgaWQgPSBuZXdlc3RSZWNvcmQuaWQoKVxuXG4gICAgICBpZiAodHlwZW9mIGlkID09IFwibnVtYmVyXCIpIHtcbiAgICAgICAgcmV0dXJuIGlkICsgMVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiSUQgZnJvbSBuZXdlc3QgcmVjb3JkIHdhc24ndCBhIG51bWJlclwiKVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gMVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBwcmltYXJ5IGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHByaW1hcnlLZXkgLSBQcmltYXJ5IGtleS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIHNldFByaW1hcnlLZXkocHJpbWFyeUtleSkge1xuICAgIHRoaXMuX3ByaW1hcnlLZXkgPSBwcmltYXJ5S2V5XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGlzIGNsYXNzJ3Mgb3duIGF0dHJpYnV0ZS1jYXN0IG1hcCwgY3JlYXRpbmcgaXQgb24gdGhlIGNsYXNzIGl0c2VsZlxuICAgKiAobmV2ZXIgaW5oZXJpdGVkIGZyb20gYSBwYXJlbnQpIHNvIHN1YmNsYXNzZXMgZG9uJ3Qgc2hhcmUgdGhlIHNhbWUgb2JqZWN0LlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gLSBEZWNsYXJlZCBjYXN0cyBrZXllZCBieSBhdHRyaWJ1dGUgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBnZXRBdHRyaWJ1dGVDYXN0c01hcCgpIHtcbiAgICBpZiAoIU9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbCh0aGlzLCBcIl9hdHRyaWJ1dGVDYXN0c1wiKSB8fCAhdGhpcy5fYXR0cmlidXRlQ2FzdHMpIHtcbiAgICAgIC8qKlxuICAgICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIHN0cmluZz59ICovXG4gICAgICB0aGlzLl9hdHRyaWJ1dGVDYXN0cyA9IHt9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2F0dHJpYnV0ZUNhc3RzXG4gIH1cblxuICAvKipcbiAgICogRGVjbGFyZXMgYSBSYWlscy1zdHlsZSBwZXItYXR0cmlidXRlIGNhc3Qgc28gYSBjb2x1bW4gd2hvc2UgaW50cm9zcGVjdGVkIHR5cGVcbiAgICogaXNuJ3Qgd2hhdCB0aGUgYXBwIHdhbnRzIChlLmcuIGFuIE1TU1FMIGBiaXRgIG1hcHBlZCB0byBgbnVtYmVyYCkgY2FuIGJlXG4gICAqIGV4cG9zZWQgYXMgYW5vdGhlciB0eXBlIHdpdGggcmVhbCBydW50aW1lIGNvbnZlcnNpb24uIEN1cnJlbnRseSBmdWxseVxuICAgKiBpbXBsZW1lbnRzIHRoZSBgXCJib29sZWFuXCJgIGNhc3QgKDAvMSA8LT4gZmFsc2UvdHJ1ZSk7IG90aGVyIHR5cGVzIG9ubHkgcmVjb3JkXG4gICAqIHRoZSBsYWJlbCBzbyB0aGUgZWZmZWN0aXZlIHR5cGUgYW5kIGdlbmVyYXRlZCB0eXBpbmdzIHJlZmxlY3QgdGhlbS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZSAoY2FtZWxDYXNlKSwgZS5nLiBgXCJzaWNodGJhclZWS1wiYC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHR5cGUgLSBEZWNsYXJlZCB0eXBlLCBlLmcuIGBcImJvb2xlYW5cImAuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBhdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSwgdHlwZSkge1xuICAgIHRoaXMuZ2V0QXR0cmlidXRlQ2FzdHNNYXAoKVthdHRyaWJ1dGVOYW1lXSA9IHR5cGVcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBkZWNsYXJlZCBjYXN0IHR5cGUgZm9yIGFuIGF0dHJpYnV0ZSwgaWYgYW55LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lIChjYW1lbENhc2UpLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIERlY2xhcmVkIGNhc3QgdHlwZSwgb3IgdW5kZWZpbmVkIHdoZW4gbm9uZSBpcyBkZWNsYXJlZC5cbiAgICovXG4gIHN0YXRpYyBnZXRBdHRyaWJ1dGVDYXN0KGF0dHJpYnV0ZU5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRBdHRyaWJ1dGVDYXN0c01hcCgpW2F0dHJpYnV0ZU5hbWVdXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcmltYXJ5IGtleS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgcHJpbWFyeSBrZXkuXG4gICAqL1xuICBzdGF0aWMgcHJpbWFyeUtleSgpIHtcbiAgICBpZiAodGhpcy5fcHJpbWFyeUtleSkgcmV0dXJuIHRoaXMuX3ByaW1hcnlLZXlcblxuICAgIHJldHVybiBcImlkXCJcbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHRoZSBtb2RlbCBoYXMgYSBzaW5nbGUgcHJpbWFyeSBrZXkgY29sdW1uLiBgc2V0UHJpbWFyeUtleShudWxsKWAgKGUuZy4gY29tcG9zaXRlLWtleVxuICAgKiBsZWdhY3kgdGFibGVzKSBkZWNsYXJlcyBubyBzaW5nbGUgcHJpbWFyeSBrZXk7IGBwcmltYXJ5S2V5KClgIHN0aWxsIGZhbGxzIGJhY2sgdG8gXCJpZFwiIGZvciB0aGVcbiAgICogZGVmYXVsdCBjYXNlLCBzbyBjYWxsZXJzIHRoYXQgbXVzdCBkaXN0aW5ndWlzaCBcIm5vIHByaW1hcnkga2V5XCIgdXNlIHRoaXMgaW5zdGVhZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gRmFsc2Ugb25seSB3aGVuIHRoZSBwcmltYXJ5IGtleSB3YXMgZXhwbGljaXRseSBzZXQgdG8gbnVsbC5cbiAgICovXG4gIHN0YXRpYyBoYXNQcmltYXJ5S2V5KCkge1xuICAgIHJldHVybiB0aGlzLl9wcmltYXJ5S2V5ICE9PSBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzYXZlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgc2F2ZSgpIHtcbiAgICBjb25zdCBpc05ld1JlY29yZCA9IHRoaXMuaXNOZXdSZWNvcmQoKVxuICAgIGxldCByZXN1bHRcblxuICAgIGNvbnN0IHNhdmUgPSBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLl9ydW5MaWZlY3ljbGVDYWxsYmFja3MoXCJiZWZvcmVWYWxpZGF0aW9uXCIpXG4gICAgICBhd2FpdCB0aGlzLl9ydW5WYWxpZGF0aW9ucygpXG5cbiAgICAgIGNvbnN0IHNhdmVJblRyYW5zYWN0aW9uID0gYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCB0aGlzLl9ydW5MaWZlY3ljbGVDYWxsYmFja3MoXCJiZWZvcmVTYXZlXCIpXG5cbiAgICAgICAgLy8gSWYgYW55IGJlbG9uZ3MtdG8tcmVsYXRpb25zaGlwcyB3YXMgc2F2ZWQsIHRoZW4gdXBkYXRlZC1hdCBzaG91bGQgc3RpbGwgYmUgc2V0IG9uIHRoaXMgcmVjb3JkLlxuICAgICAgICBjb25zdCB7c2F2ZWRDb3VudH0gPSBhd2FpdCB0aGlzLl9hdXRvU2F2ZUJlbG9uZ3NUb1JlbGF0aW9uc2hpcHMoKVxuXG4gICAgICAgIGlmICh0aGlzLmlzUGVyc2lzdGVkKCkpIHtcbiAgICAgICAgICBhd2FpdCB0aGlzLl9ydW5MaWZlY3ljbGVDYWxsYmFja3MoXCJiZWZvcmVVcGRhdGVcIilcblxuICAgICAgICAgIC8vIElmIGFueSBoYXMtbWFueS1yZWxhdGlvbnNoaXBzIHdpbGwgYmUgc2F2ZWQsIHRoZW4gdXBkYXRlZC1hdCBzaG91bGQgc3RpbGwgYmUgc2V0IG9uIHRoaXMgcmVjb3JkLlxuICAgICAgICAgIGNvbnN0IGF1dG9TYXZlSGFzTWFueXJlbGF0aW9uc2hpcHMgPSB0aGlzLl9hdXRvU2F2ZUhhc01hbnlBbmRIYXNPbmVSZWxhdGlvbnNoaXBzVG9TYXZlKClcblxuICAgICAgICAgIGlmICh0aGlzLl9oYXNDaGFuZ2VzKCkgfHwgc2F2ZWRDb3VudCA+IDAgfHwgYXV0b1NhdmVIYXNNYW55cmVsYXRpb25zaGlwcy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICByZXN1bHQgPSBhd2FpdCB0aGlzLl91cGRhdGVSZWNvcmRXaXRoQ2hhbmdlcygpXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgYXdhaXQgdGhpcy5fcnVuTGlmZWN5Y2xlQ2FsbGJhY2tzKFwiYWZ0ZXJVcGRhdGVcIilcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBhd2FpdCB0aGlzLl9ydW5MaWZlY3ljbGVDYWxsYmFja3MoXCJiZWZvcmVDcmVhdGVcIilcbiAgICAgICAgICByZXN1bHQgPSBhd2FpdCB0aGlzLl9jcmVhdGVOZXdSZWNvcmQoKVxuICAgICAgICAgIGF3YWl0IHRoaXMuX3J1bkxpZmVjeWNsZUNhbGxiYWNrcyhcImFmdGVyQ3JlYXRlXCIpXG4gICAgICAgIH1cblxuICAgICAgICBhd2FpdCB0aGlzLl9hdXRvU2F2ZUhhc01hbnlBbmRIYXNPbmVSZWxhdGlvbnNoaXBzKHtpc05ld1JlY29yZH0pXG4gICAgICAgIGF3YWl0IHRoaXMuX2F1dG9TYXZlQXR0YWNobWVudHMoKVxuICAgICAgICBhd2FpdCB0aGlzLl9ydW5MaWZlY3ljbGVDYWxsYmFja3MoXCJhZnRlclNhdmVcIilcbiAgICAgICAgYXdhaXQgdGhpcy5fZW1pdFJlY29yZENoYW5nZUFmdGVyQ29tbWl0KGlzTmV3UmVjb3JkID8gXCJjcmVhdGVcIiA6IFwidXBkYXRlXCIpXG4gICAgICB9XG5cbiAgICAgIGlmICh0aGlzLl9kYXRhYmFzZU9wZXJhdGlvbikge1xuICAgICAgICBhd2FpdCB0aGlzLl9kYXRhYmFzZU9wZXJhdGlvbi50cmFuc2FjdGlvbihzYXZlSW5UcmFuc2FjdGlvbilcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGF3YWl0IHRoaXMuZ2V0TW9kZWxDbGFzcygpLnRyYW5zYWN0aW9uKHNhdmVJblRyYW5zYWN0aW9uKVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh0aGlzLl9kYXRhYmFzZU9wZXJhdGlvbikge1xuICAgICAgYXdhaXQgc2F2ZSgpXG4gICAgfSBlbHNlIHtcbiAgICAgIGF3YWl0IHRoaXMuX2dldENvbmZpZ3VyYXRpb24oKS5lbnN1cmVDb25uZWN0aW9ucyh7bmFtZTogYCR7dGhpcy5nZXRNb2RlbENsYXNzKCkubmFtZX0gc2F2ZWB9LCBzYXZlKVxuICAgIH1cblxuICAgIHRoaXMuX2Fzc2lnbmVkQXR0cmlidXRlTmFtZXMgPSB1bmRlZmluZWRcblxuICAgIHJldHVybiByZXN1bHRcbiAgfVxuXG4gIGFzeW5jIF9hdXRvU2F2ZUJlbG9uZ3NUb1JlbGF0aW9uc2hpcHMoKSB7XG4gICAgbGV0IHNhdmVkQ291bnQgPSAwXG5cbiAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgaW4gdGhpcy5faW5zdGFuY2VSZWxhdGlvbnNoaXBzKSB7XG4gICAgICBjb25zdCBpbnN0YW5jZVJlbGF0aW9uc2hpcCA9IHRoaXMuX2luc3RhbmNlUmVsYXRpb25zaGlwc1tyZWxhdGlvbnNoaXBOYW1lXVxuXG4gICAgICBpZiAoaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0VHlwZSgpICE9IFwiYmVsb25nc1RvXCIpIHtcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGluc3RhbmNlUmVsYXRpb25zaGlwLmdldEF1dG9TYXZlKCkgPT09IGZhbHNlKSB7XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IG1vZGVsID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0TG9hZGVkT3JVbmRlZmluZWQoKVxuXG4gICAgICBpZiAobW9kZWwpIHtcbiAgICAgICAgaWYgKG1vZGVsIGluc3RhbmNlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQpIHtcbiAgICAgICAgICBpZiAobW9kZWwuaXNDaGFuZ2VkKCkpIHtcbiAgICAgICAgICAgIHRoaXMuYmluZFJlbGF0ZWRSZWNvcmQobW9kZWwpXG4gICAgICAgICAgICBhd2FpdCBtb2RlbC5zYXZlKClcblxuICAgICAgICAgICAgY29uc3QgZm9yZWlnbktleSA9IHRoaXMuX3JlbGF0aW9uc2hpcEZvcmVpZ25LZXlBdHRyaWJ1dGUoaW5zdGFuY2VSZWxhdGlvbnNoaXApXG4gICAgICAgICAgICBjb25zdCBmb3JlaWduS2V5VmFsdWUgPSB0aGlzLl9iZWxvbmdzVG9Gb3JlaWduS2V5VmFsdWUoe21vZGVsLCByZWxhdGlvbnNoaXA6IGluc3RhbmNlUmVsYXRpb25zaGlwfSlcblxuICAgICAgICAgICAgdGhpcy5zZXRBdHRyaWJ1dGUoZm9yZWlnbktleSwgZm9yZWlnbktleVZhbHVlKVxuXG4gICAgICAgICAgICBpbnN0YW5jZVJlbGF0aW9uc2hpcC5zZXRQcmVsb2FkZWQodHJ1ZSlcbiAgICAgICAgICAgIGluc3RhbmNlUmVsYXRpb25zaGlwLnNldERpcnR5KGZhbHNlKVxuXG4gICAgICAgICAgICBzYXZlZENvdW50KytcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBhIHJlY29yZCBidXQgZ290OiAke3R5cGVvZiBtb2RlbH1gKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHtzYXZlZENvdW50fVxuICB9XG5cbiAgX2F1dG9TYXZlSGFzTWFueUFuZEhhc09uZVJlbGF0aW9uc2hpcHNUb1NhdmUoKSB7XG4gICAgY29uc3QgcmVsYXRpb25zaGlwcyA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgaW4gdGhpcy5faW5zdGFuY2VSZWxhdGlvbnNoaXBzKSB7XG4gICAgICBjb25zdCBpbnN0YW5jZVJlbGF0aW9uc2hpcCA9IHRoaXMuX2luc3RhbmNlUmVsYXRpb25zaGlwc1tyZWxhdGlvbnNoaXBOYW1lXVxuXG4gICAgICBpZiAoaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0VHlwZSgpICE9IFwiaGFzTWFueVwiICYmIGluc3RhbmNlUmVsYXRpb25zaGlwLmdldFR5cGUoKSAhPSBcImhhc09uZVwiKSB7XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRBdXRvU2F2ZSgpID09PSBmYWxzZSkge1xuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICAvKipcbiAgICAgICAqIERlZmluZXMgbG9hZGVkLlxuICAgICAgICogQHR5cGUge1ZlbG9jaW91c0RhdGFiYXNlUmVjb3JkW119ICovXG4gICAgICBsZXQgbG9hZGVkXG5cbiAgICAgIGNvbnN0IGhhc01hbnlPck9uZUxvYWRlZCA9IGluc3RhbmNlUmVsYXRpb25zaGlwLmdldExvYWRlZE9yVW5kZWZpbmVkKClcblxuICAgICAgaWYgKGhhc01hbnlPck9uZUxvYWRlZCkge1xuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShoYXNNYW55T3JPbmVMb2FkZWQpKSB7XG4gICAgICAgICAgbG9hZGVkID0gaGFzTWFueU9yT25lTG9hZGVkXG4gICAgICAgIH0gZWxzZSBpZiAoaGFzTWFueU9yT25lTG9hZGVkIGluc3RhbmNlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQpIHtcbiAgICAgICAgICBsb2FkZWQgPSBbaGFzTWFueU9yT25lTG9hZGVkXVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgaGFzT25lTG9hZGVkIHRvIGJlIGEgcmVjb3JkIGJ1dCBpdCB3YXNuJ3Q6ICR7dHlwZW9mIGhhc01hbnlPck9uZUxvYWRlZH1gKVxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBsZXQgdXNlUmVsYXRpb25zaGlwID0gZmFsc2VcblxuICAgICAgaWYgKGxvYWRlZCkge1xuICAgICAgICBmb3IgKGNvbnN0IG1vZGVsIG9mIGxvYWRlZCkge1xuICAgICAgICAgIHRoaXMuYmluZFJlbGF0ZWRSZWNvcmQobW9kZWwpXG4gICAgICAgICAgY29uc3QgZm9yZWlnbktleSA9IG1vZGVsLl9yZWxhdGlvbnNoaXBGb3JlaWduS2V5QXR0cmlidXRlKGluc3RhbmNlUmVsYXRpb25zaGlwKVxuXG4gICAgICAgICAgbW9kZWwuc2V0QXR0cmlidXRlKGZvcmVpZ25LZXksIHRoaXMuaWQoKSlcblxuICAgICAgICAgIGlmIChtb2RlbC5pc0NoYW5nZWQoKSkge1xuICAgICAgICAgICAgdXNlUmVsYXRpb25zaGlwID0gdHJ1ZVxuICAgICAgICAgICAgY29udGludWVcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKHVzZVJlbGF0aW9uc2hpcCkgcmVsYXRpb25zaGlwcy5wdXNoKGluc3RhbmNlUmVsYXRpb25zaGlwKVxuICAgIH1cblxuICAgIHJldHVybiByZWxhdGlvbnNoaXBzXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYSByZWxhdGlvbnNoaXAgZm9yZWlnbi1rZXkgY29sdW1uIHRvIHRoaXMgbW9kZWwncyBwdWJsaWMgYXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9pbnN0YW5jZS1yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdDx0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQsIHR5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZD59IGluc3RhbmNlUmVsYXRpb25zaGlwIC0gUmVsYXRpb25zaGlwIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSBBdHRyaWJ1dGUgbmFtZSBhY2NlcHRlZCBieSBzZXRBdHRyaWJ1dGUvYXNzaWduLlxuICAgKi9cbiAgX3JlbGF0aW9uc2hpcEZvcmVpZ25LZXlBdHRyaWJ1dGUoaW5zdGFuY2VSZWxhdGlvbnNoaXApIHtcbiAgICBjb25zdCBmb3JlaWduS2V5ID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0Rm9yZWlnbktleSgpXG5cbiAgICByZXR1cm4gdGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCgpW2ZvcmVpZ25LZXldIHx8IGZvcmVpZ25LZXlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGF1dG8gc2F2ZSBoYXMgbWFueSBhbmQgaGFzIG9uZSByZWxhdGlvbnNoaXBzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MuaXNOZXdSZWNvcmQgLSBXaGV0aGVyIGlzIG5ldyByZWNvcmQuXG4gICAqL1xuICBhc3luYyBfYXV0b1NhdmVIYXNNYW55QW5kSGFzT25lUmVsYXRpb25zaGlwcyh7aXNOZXdSZWNvcmR9KSB7XG4gICAgZm9yIChjb25zdCBpbnN0YW5jZVJlbGF0aW9uc2hpcCBvZiB0aGlzLl9hdXRvU2F2ZUhhc01hbnlBbmRIYXNPbmVSZWxhdGlvbnNoaXBzVG9TYXZlKCkpIHtcbiAgICAgIGxldCBoYXNNYW55T3JPbmVMb2FkZWQgPSBpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRMb2FkZWRPclVuZGVmaW5lZCgpXG5cbiAgICAgIC8qKlxuICAgICAgICogRGVmaW5lcyBsb2FkZWQuXG4gICAgICAgKiBAdHlwZSB7VmVsb2Npb3VzRGF0YWJhc2VSZWNvcmRbXX0gKi9cbiAgICAgIGxldCBsb2FkZWRcblxuICAgICAgaWYgKGhhc01hbnlPck9uZUxvYWRlZCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGxvYWRlZCA9IFtdXG4gICAgICB9IGVsc2UgaWYgKGhhc01hbnlPck9uZUxvYWRlZCBpbnN0YW5jZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkKSB7XG4gICAgICAgIGxvYWRlZCA9IFtoYXNNYW55T3JPbmVMb2FkZWRdXG4gICAgICB9IGVsc2UgaWYgKEFycmF5LmlzQXJyYXkoaGFzTWFueU9yT25lTG9hZGVkKSkge1xuICAgICAgICBsb2FkZWQgPSBoYXNNYW55T3JPbmVMb2FkZWRcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5leHBlY3RlZCB0eXBlIGZvciBoYXNNYW55T3JPbmVMb2FkZWQ6ICR7dHlwZW9mIGhhc01hbnlPck9uZUxvYWRlZH1gKVxuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IG1vZGVsIG9mIGxvYWRlZCkge1xuICAgICAgICB0aGlzLmJpbmRSZWxhdGVkUmVjb3JkKG1vZGVsKVxuICAgICAgICBjb25zdCBmb3JlaWduS2V5ID0gbW9kZWwuX3JlbGF0aW9uc2hpcEZvcmVpZ25LZXlBdHRyaWJ1dGUoaW5zdGFuY2VSZWxhdGlvbnNoaXApXG5cbiAgICAgICAgbW9kZWwuc2V0QXR0cmlidXRlKGZvcmVpZ25LZXksIHRoaXMuaWQoKSlcblxuICAgICAgICBpZiAobW9kZWwuaXNDaGFuZ2VkKCkpIHtcbiAgICAgICAgICBhd2FpdCBtb2RlbC5zYXZlKClcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAoaXNOZXdSZWNvcmQpIHtcbiAgICAgICAgaW5zdGFuY2VSZWxhdGlvbnNoaXAuc2V0UHJlbG9hZGVkKHRydWUpXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXV0byBzYXZlIGF0dGFjaG1lbnRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHBlbmRpbmcgYXR0YWNobWVudHMgaGF2ZSBiZWVuIHNhdmVkLlxuICAgKi9cbiAgYXN5bmMgX2F1dG9TYXZlQXR0YWNobWVudHMoKSB7XG4gICAgZm9yIChjb25zdCBhdHRhY2htZW50TmFtZSBpbiB0aGlzLl9hdHRhY2htZW50cykge1xuICAgICAgY29uc3QgYXR0YWNobWVudCA9IHRoaXMuX2F0dGFjaG1lbnRzW2F0dGFjaG1lbnROYW1lXVxuXG4gICAgICBpZiAoIWF0dGFjaG1lbnQuaGFzUGVuZGluZ0F0dGFjaG1lbnRzKCkpIGNvbnRpbnVlXG5cbiAgICAgIGF3YWl0IGF0dGFjaG1lbnQuZmx1c2hQZW5kaW5nQXR0YWNobWVudHMoKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRhYmxlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHRhYmxlIG5hbWUuXG4gICAqL1xuICBzdGF0aWMgdGFibGVOYW1lKCkge1xuICAgIGlmICghdGhpcy5fdGFibGVOYW1lKSB0aGlzLl90YWJsZU5hbWUgPSBpbmZsZWN0aW9uLnVuZGVyc2NvcmUoaW5mbGVjdGlvbi5wbHVyYWxpemUodGhpcy5nZXRNb2RlbE5hbWUoKSkpXG5cbiAgICByZXR1cm4gdGhpcy5fdGFibGVOYW1lXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgdGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIFRhYmxlIG5hbWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBzZXRUYWJsZU5hbWUodGFibGVOYW1lKSB7XG4gICAgdGhpcy5fdGFibGVOYW1lID0gdGFibGVOYW1lXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0cmFuc2FjdGlvbi5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPHZvaWQ+fSBjYWxsYmFjayAtIENhbGxiYWNrIGZ1bmN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgdHJhbnNhY3Rpb24uXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgdHJhbnNhY3Rpb24oY2FsbGJhY2spIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIGNvbnN0IHVzZVRyYW5zYWN0aW9ucyA9IHRoaXMuY29ubmVjdGlvbigpLmdldEFyZ3MoKS5yZWNvcmQ/LnRyYW5zYWN0aW9uc1xuXG4gICAgaWYgKHVzZVRyYW5zYWN0aW9ucyAhPT0gZmFsc2UpIHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmNvbm5lY3Rpb24oKS50cmFuc2FjdGlvbihjYWxsYmFjaylcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIGF3YWl0IGNhbGxiYWNrKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyB0aGUgY2FsbGJhY2sgd2hpbGUgaG9sZGluZyBhIG5hbWVkIGFkdmlzb3J5IGxvY2suIENhbGxzIHdpdGhvdXRcbiAgICogQnkgZGVmYXVsdCBjYWxscyB1c2UgdGhlIGNhbGxlciBjb25uZWN0aW9uLiBDYWxscyB3aXRoIGBkZWRpY2F0ZWRDb25uZWN0aW9uYFxuICAgKiB1c2UgYSBzcGF3bmVkIGxvY2sgY29ubmVjdGlvbiB0aGF0IGlzIHJlbGVhc2VkIGFmdGVyIHRoZSBjYWxsYmFjayBmaW5pc2hlcyxcbiAgICogd2hpbGUgdGhlIGNhbGxiYWNrIGl0c2VsZiBzdGlsbCBydW5zIGFnYWluc3QgdGhlIGNhbGxlci9tb2RlbCBjb25uZWN0aW9uLlxuICAgKiBDYWxscyB3aXRoIGEgcG9zaXRpdmUgYGhvbGRUaW1lb3V0TXNgIHVzZSBhIGRlZGljYXRlZCBsb2NrIGNvbm5lY3Rpb24gc29cbiAgICogdGltZW91dCBjbGVhbnVwIGNhbiByZWxlYXNlIHRoZSBsb2NrIGV2ZW4gd2hlbiBjYWxsYmFjayBkYXRhYmFzZSB3b3JrIGlzXG4gICAqIHN0dWNrLiBBZHZpc29yeSBsb2NrcyBhcmUgY29vcGVyYXRpdmUgYW5kIHNlc3Npb24tc2NvcGVkOiB0aGV5IHNlcmlhbGl6ZVxuICAgKiBjYWxsZXJzIHRoYXQgb3B0IGludG8gdGhlIHNhbWUgYG5hbWVgLCB3aXRob3V0IHRvdWNoaW5nIHJvdyBvciB0YWJsZSBsb2NrcyxcbiAgICogc28gdW5yZWxhdGVkIHRyYWZmaWMgaXMgZnJlZSB0byBwcm9jZWVkLlxuICAgKlxuICAgKiBUaGUgbG9jayBpcyBhY3F1aXJlZCBiZWZvcmUgdGhlIGNhbGxiYWNrIHJ1bnMgYW5kIHJlbGVhc2VkIGluIGFcbiAgICogYGZpbmFsbHlgIGJsb2NrIGFmdGVyd2FyZHMsIHNvIHRoZSBjYWxsYmFjaydzIHJldHVybiB2YWx1ZSBpc1xuICAgKiBwcm9wYWdhdGVkIGFuZCB0aHJvd24gZXJyb3JzIHN0aWxsIHJlbGVhc2UgdGhlIGxvY2suXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgdG8gaW52b2tlIHdoaWxlIHRoZSBsb2NrIGlzIGhlbGQuXG4gICAqIEBwYXJhbSB7e3RpbWVvdXRNcz86IG51bWJlciB8IG51bGwsIGhvbGRUaW1lb3V0TXM/OiBudW1iZXIgfCBudWxsLCBkZWRpY2F0ZWRDb25uZWN0aW9uPzogYm9vbGVhbn19IFthcmdzXSAtIGB0aW1lb3V0TXNgIGNhcHMgaG93IGxvbmcgd2Ugd2FpdCB0byBhY3F1aXJlIHRoZSBsb2NrOyBgaG9sZFRpbWVvdXRNc2AgY2FwcyBob3cgbG9uZyB0aGUgY2FsbGJhY2sgbWF5IGhvbGQgaXQgYmVmb3JlIHRoZSBsb2NrIGlzIHJlbGVhc2VkIGFuZCBgQWR2aXNvcnlMb2NrSG9sZFRpbWVvdXRFcnJvcmAgaXMgdGhyb3duOyBgZGVkaWNhdGVkQ29ubmVjdGlvbmAgc3Bhd25zIGEgc2VwYXJhdGUgbG9jayBzZXNzaW9uIHdpdGhvdXQgZW5hYmxpbmcgYSBob2xkIHRpbWVvdXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNhbGxiYWNrJ3MgcmV0dXJuIHZhbHVlLlxuICAgKiBAdGhyb3dzIHtBZHZpc29yeUxvY2tUaW1lb3V0RXJyb3J9IC0gSWYgYHRpbWVvdXRNc2AgZWxhcHNlcyBiZWZvcmUgdGhlIGxvY2sgaXMgZ3JhbnRlZC5cbiAgICogQHRocm93cyB7QWR2aXNvcnlMb2NrSG9sZFRpbWVvdXRFcnJvcn0gLSBJZiBgaG9sZFRpbWVvdXRNc2AgZWxhcHNlcyB3aGlsZSB0aGUgY2FsbGJhY2sgaG9sZHMgdGhlIGxvY2suXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgd2l0aEFkdmlzb3J5TG9jayhuYW1lLCBjYWxsYmFjaywgYXJncyA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpXG5cbiAgICBjb25zdCBydW5uZXIgPSBuZXcgQWR2aXNvcnlMb2NrUnVubmVyKHtcbiAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuX2dldENvbmZpZ3VyYXRpb24oKSxcbiAgICAgIGNvbm5lY3Rpb25Qcm92aWRlcjogKCkgPT4gdGhpcy5jb25uZWN0aW9uKCksXG4gICAgICBkYXRhYmFzZUlkZW50aWZpZXI6IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKClcbiAgICB9KVxuXG4gICAgcmV0dXJuIGF3YWl0IHJ1bm5lci53aXRoQWR2aXNvcnlMb2NrKG5hbWUsIGNhbGxiYWNrLCBhcmdzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdGhlIGNhbGxiYWNrIG9ubHkgaWYgdGhlIG5hbWVkIGFkdmlzb3J5IGxvY2sgY2FuIGJlIGFjcXVpcmVkXG4gICAqIGltbWVkaWF0ZWx5LiBJZiB0aGUgbG9jayBpcyBhbHJlYWR5IGhlbGQgYnkgYW55IHNlc3Npb24sIHRocm93c1xuICAgKiBgQWR2aXNvcnlMb2NrQnVzeUVycm9yYCB3aXRob3V0IHdhaXRpbmcuXG4gICAqIFVzZSB0aGlzIHdoZW4gY29udGVudGlvbiBpcyBhIHNpZ25hbCB0aGF0IHNvbWVib2R5IGVsc2UgaXMgYWxyZWFkeVxuICAgKiBkb2luZyB0aGUgd29yayBhbmQgeW91IHdhbnQgdG8gYmFpbCBvdXQgcmF0aGVyIHRoYW4gcXVldWUgdXAuXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgdG8gaW52b2tlIHdoaWxlIHRoZSBsb2NrIGlzIGhlbGQuXG4gICAqIEBwYXJhbSB7e2hvbGRUaW1lb3V0TXM/OiBudW1iZXIgfCBudWxsLCBkZWRpY2F0ZWRDb25uZWN0aW9uPzogYm9vbGVhbn19IFthcmdzXSAtIGBob2xkVGltZW91dE1zYCBjYXBzIGhvdyBsb25nIHRoZSBjYWxsYmFjayBtYXkgaG9sZCB0aGUgbG9jayBiZWZvcmUgaXQgaXMgcmVsZWFzZWQgYW5kIGBBZHZpc29yeUxvY2tIb2xkVGltZW91dEVycm9yYCBpcyB0aHJvd247IGBkZWRpY2F0ZWRDb25uZWN0aW9uYCBzcGF3bnMgYSBzZXBhcmF0ZSBsb2NrIHNlc3Npb24gd2l0aG91dCBlbmFibGluZyBhIGhvbGQgdGltZW91dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY2FsbGJhY2sncyByZXR1cm4gdmFsdWUuXG4gICAqIEB0aHJvd3Mge0Fkdmlzb3J5TG9ja0J1c3lFcnJvcn0gLSBJZiB0aGUgbG9jayBpcyBhbHJlYWR5IGhlbGQuXG4gICAqIEB0aHJvd3Mge0Fkdmlzb3J5TG9ja0hvbGRUaW1lb3V0RXJyb3J9IC0gSWYgYGhvbGRUaW1lb3V0TXNgIGVsYXBzZXMgd2hpbGUgdGhlIGNhbGxiYWNrIGhvbGRzIHRoZSBsb2NrLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHdpdGhBZHZpc29yeUxvY2tPckZhaWwobmFtZSwgY2FsbGJhY2ssIGFyZ3MgPSB7fSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlSW5pdGlhbGl6ZWQoKVxuXG4gICAgY29uc3QgcnVubmVyID0gbmV3IEFkdmlzb3J5TG9ja1J1bm5lcih7XG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLl9nZXRDb25maWd1cmF0aW9uKCksXG4gICAgICBjb25uZWN0aW9uUHJvdmlkZXI6ICgpID0+IHRoaXMuY29ubmVjdGlvbigpLFxuICAgICAgZGF0YWJhc2VJZGVudGlmaWVyOiB0aGlzLmdldERhdGFiYXNlSWRlbnRpZmllcigpXG4gICAgfSlcblxuICAgIHJldHVybiBhd2FpdCBydW5uZXIud2l0aEFkdmlzb3J5TG9ja09yRmFpbChuYW1lLCBjYWxsYmFjaywgYXJncylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGBjYWxsYmFja2AsIHJlamVjdGluZyB3aXRoIGBBZHZpc29yeUxvY2tIb2xkVGltZW91dEVycm9yYCBpZiBpdCBoYXNcbiAgICogbm90IHNldHRsZWQgd2l0aGluIGBob2xkVGltZW91dE1zYC4gVGhlIGNhbGxiYWNrIGlzIG5vdCBjYW5jZWxsZWQg4oCUIHRoaXMgaXNcbiAgICogYSBzYWZldHkgbmV0LCBub3QgY2FuY2VsbGF0aW9uLlxuICAgKiBAdGVtcGxhdGUgVFxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZSAoZm9yIHRoZSBlcnJvciBtZXNzYWdlKS5cbiAgICogQHBhcmFtIHsoKSA9PiBQcm9taXNlPFQ+fSBjYWxsYmFjayAtIENhbGxiYWNrIGhvbGRpbmcgdGhlIGxvY2suXG4gICAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbH0gW2hvbGRUaW1lb3V0TXNdIC0gTWF4IGhvbGQgdGltZTsgZmFsc3kgZGlzYWJsZXMgdGhlIHRpbWVvdXQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSAtIENhbGxiYWNrIHJlc3VsdCBhZnRlciB0aGUgbG9jay1wcm90ZWN0ZWQgb3BlcmF0aW9uLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHJ1bldpdGhBZHZpc29yeUxvY2tIb2xkVGltZW91dChuYW1lLCBjYWxsYmFjaywgaG9sZFRpbWVvdXRNcykge1xuICAgIHJldHVybiBhd2FpdCBBZHZpc29yeUxvY2tSdW5uZXIucnVuV2l0aEFkdmlzb3J5TG9ja0hvbGRUaW1lb3V0KG5hbWUsIGNhbGxiYWNrLCBob2xkVGltZW91dE1zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdHJ1ZSBpZiB0aGUgbmFtZWQgYWR2aXNvcnkgbG9jayBpcyBjdXJyZW50bHkgaGVsZCBieSBhbnlcbiAgICogc2Vzc2lvbi4gUHJpbWFyaWx5IHVzZWZ1bCBhcyBhIGRpYWdub3N0aWM7IGNhbGxlcnMgdGhhdCB3YW50IHRvIGFjdFxuICAgKiBvbiB0aGUgcmVzdWx0IHNob3VsZCBwcmVmZXIgYHdpdGhBZHZpc29yeUxvY2tPckZhaWxgIHRvIGF2b2lkIGFcbiAgICogVE9DVE9VIHdpbmRvdyBiZXR3ZWVuIHRoZSBjaGVjayBhbmQgdGhlIGFjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFdoZXRoZXIgdGhlIGFkdmlzb3J5IGxvY2sgaXMgY3VycmVudGx5IGhlbGQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgaGFzQWR2aXNvcnlMb2NrKG5hbWUpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLmNvbm5lY3Rpb24oKS5pc0Fkdmlzb3J5TG9ja0hlbGQobmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRyYW5zbGF0ZXMuXG4gICAqIEBwYXJhbSB7Li4uc3RyaW5nfSBuYW1lcyAtIE5hbWVzLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgdHJhbnNsYXRlcyguLi5uYW1lcykge1xuICAgIGNvbnN0IHRyYW5zbGF0aW9ucyA9IHRoaXMuZ2V0VHJhbnNsYXRpb25zTWFwKClcblxuICAgIGZvciAoY29uc3QgbmFtZSBvZiBuYW1lcykge1xuICAgICAgaWYgKG5hbWUgaW4gdHJhbnNsYXRpb25zKSB0aHJvdyBuZXcgRXJyb3IoYFRyYW5zbGF0aW9uIGFscmVhZHkgZXhpc3RzOiAke25hbWV9YClcblxuICAgICAgdHJhbnNsYXRpb25zW25hbWVdID0ge31cblxuICAgICAgaWYgKCF0aGlzLl9yZWxhdGlvbnNoaXBFeGlzdHMoXCJ0cmFuc2xhdGlvbnNcIikpIHtcbiAgICAgICAgdGhpcy5fZGVmaW5lUmVsYXRpb25zaGlwKFwidHJhbnNsYXRpb25zXCIsIHtkZXBlbmRlbnQ6IFwiZGVzdHJveVwiLCBrbGFzczogdGhpcy5nZXRUcmFuc2xhdGlvbkNsYXNzKCksIHR5cGU6IFwiaGFzTWFueVwifSlcbiAgICAgIH1cblxuICAgICAgaWYgKCF0aGlzLl9yZWxhdGlvbnNoaXBFeGlzdHMoXCJjdXJyZW50VHJhbnNsYXRpb25cIikpIHtcbiAgICAgICAgdGhpcy5fZGVmaW5lUmVsYXRpb25zaGlwKFwiY3VycmVudFRyYW5zbGF0aW9uXCIsIHtcbiAgICAgICAgICBrbGFzczogdGhpcy5nZXRUcmFuc2xhdGlvbkNsYXNzKCksXG4gICAgICAgICAgc2NvcGU6IChxdWVyeSkgPT4gdGhpcy5jdXJyZW50VHJhbnNsYXRpb25TY29wZShxdWVyeSksXG4gICAgICAgICAgdHlwZTogXCJoYXNPbmVcIlxuICAgICAgICB9KVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGN1cnJlbnQgdHJhbnNsYXRpb24gc2NvcGUuXG4gICAqIEBwYXJhbSB7TW9kZWxDbGFzc1F1ZXJ5fSBxdWVyeSAtIFRyYW5zbGF0aW9uIHF1ZXJ5LlxuICAgKiBAcmV0dXJucyB7TW9kZWxDbGFzc1F1ZXJ5fSAtIFNjb3BlZCBxdWVyeS5cbiAgICovXG4gIHN0YXRpYyBjdXJyZW50VHJhbnNsYXRpb25TY29wZShxdWVyeSkge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLl9nZXRDb25maWd1cmF0aW9uKClcbiAgICBjb25zdCBsb2NhbGUgPSBjb25maWd1cmF0aW9uLmdldExvY2FsZSgpXG4gICAgY29uc3QgZmFsbGJhY2tzID0gY29uZmlndXJhdGlvbi5nZXRMb2NhbGVGYWxsYmFja3MoKVxuICAgIGNvbnN0IGxvY2FsZXMgPSBsb2NhbGUgPyAoZmFsbGJhY2tzPy5bbG9jYWxlXSB8fCBbbG9jYWxlXSkgOiBbXVxuXG4gICAgaWYgKGxvY2FsZXMubGVuZ3RoID09PSAwKSByZXR1cm4gcXVlcnkud2hlcmUoXCIxPTBcIilcblxuICAgIGNvbnN0IGRyaXZlciA9IHF1ZXJ5LmRyaXZlclxuICAgIGNvbnN0IHRyYW5zbGF0aW9uQ2xhc3MgPSB0aGlzLmdldFRyYW5zbGF0aW9uQ2xhc3MoKVxuICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IHRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKFwiY3VycmVudFRyYW5zbGF0aW9uXCIpXG4gICAgY29uc3QgdGFibGVOYW1lID0gdHJhbnNsYXRpb25DbGFzcy50YWJsZU5hbWUoKVxuICAgIGNvbnN0IHNjb3BlVGFibGVSZWZlcmVuY2UgPSBgJHt0YWJsZU5hbWV9X2N1cnJlbnRfdHJhbnNsYXRpb25fc2NvcGVgXG4gICAgY29uc3QgdGFyZ2V0VGFibGVTcWwgPSBkcml2ZXIucXVvdGVUYWJsZShxdWVyeS5nZXRUYWJsZVJlZmVyZW5jZUZvckpvaW4oKSlcbiAgICBjb25zdCBzY29wZVRhYmxlU3FsID0gZHJpdmVyLnF1b3RlVGFibGUoc2NvcGVUYWJsZVJlZmVyZW5jZSlcbiAgICBjb25zdCBzY29wZVRhYmxlRnJvbVNxbCA9IGAke2RyaXZlci5xdW90ZVRhYmxlKHRhYmxlTmFtZSl9IEFTICR7c2NvcGVUYWJsZVNxbH1gXG4gICAgY29uc3QgcHJpbWFyeUtleUNvbHVtbiA9IHRyYW5zbGF0aW9uQ2xhc3MucHJpbWFyeUtleSgpXG4gICAgY29uc3QgZm9yZWlnbktleUNvbHVtbiA9IHJlbGF0aW9uc2hpcC5nZXRGb3JlaWduS2V5KClcbiAgICBjb25zdCB0YXJnZXRQcmltYXJ5S2V5U3FsID0gYCR7dGFyZ2V0VGFibGVTcWx9LiR7ZHJpdmVyLnF1b3RlQ29sdW1uKHByaW1hcnlLZXlDb2x1bW4pfWBcbiAgICBjb25zdCB0YXJnZXRGb3JlaWduS2V5U3FsID0gYCR7dGFyZ2V0VGFibGVTcWx9LiR7ZHJpdmVyLnF1b3RlQ29sdW1uKGZvcmVpZ25LZXlDb2x1bW4pfWBcbiAgICBjb25zdCBzY29wZVByaW1hcnlLZXlTcWwgPSBgJHtzY29wZVRhYmxlU3FsfS4ke2RyaXZlci5xdW90ZUNvbHVtbihwcmltYXJ5S2V5Q29sdW1uKX1gXG4gICAgY29uc3Qgc2NvcGVGb3JlaWduS2V5U3FsID0gYCR7c2NvcGVUYWJsZVNxbH0uJHtkcml2ZXIucXVvdGVDb2x1bW4oZm9yZWlnbktleUNvbHVtbil9YFxuICAgIGNvbnN0IHNjb3BlTG9jYWxlU3FsID0gYCR7c2NvcGVUYWJsZVNxbH0uJHtkcml2ZXIucXVvdGVDb2x1bW4oXCJsb2NhbGVcIil9YFxuICAgIGNvbnN0IGxvY2FsZUxpc3RTcWwgPSBsb2NhbGVzLm1hcCgoZmFsbGJhY2tMb2NhbGUpID0+IGRyaXZlci5xdW90ZShmYWxsYmFja0xvY2FsZSkpLmpvaW4oXCIsIFwiKVxuICAgIGNvbnN0IGxvY2FsZU9yZGVyU3FsID0gbG9jYWxlcy5tYXAoKGZhbGxiYWNrTG9jYWxlLCBpbmRleCkgPT4gYFdIRU4gJHtzY29wZUxvY2FsZVNxbH0gPSAke2RyaXZlci5xdW90ZShmYWxsYmFja0xvY2FsZSl9IFRIRU4gJHtkcml2ZXIucXVvdGUoaW5kZXgpfWApLmpvaW4oXCIgXCIpXG4gICAgY29uc3QgZmFsbGJhY2tPcmRlclNxbCA9IGBDQVNFICR7bG9jYWxlT3JkZXJTcWx9IEVMU0UgJHtkcml2ZXIucXVvdGUobG9jYWxlcy5sZW5ndGgpfSBFTkRgXG4gICAgY29uc3Qgc2VsZWN0ZWRUcmFuc2xhdGlvblNxbCA9IGRyaXZlci5nZXRUeXBlKCkgPT0gXCJtc3NxbFwiXG4gICAgICA/IGBTRUxFQ1QgVE9QIDEgJHtzY29wZVByaW1hcnlLZXlTcWx9IEZST00gJHtzY29wZVRhYmxlRnJvbVNxbH0gV0hFUkUgJHtzY29wZUZvcmVpZ25LZXlTcWx9ID0gJHt0YXJnZXRGb3JlaWduS2V5U3FsfSBBTkQgJHtzY29wZUxvY2FsZVNxbH0gSU4gKCR7bG9jYWxlTGlzdFNxbH0pIE9SREVSIEJZICR7ZmFsbGJhY2tPcmRlclNxbH0sICR7c2NvcGVQcmltYXJ5S2V5U3FsfSBBU0NgXG4gICAgICA6IGBTRUxFQ1QgJHtzY29wZVByaW1hcnlLZXlTcWx9IEZST00gJHtzY29wZVRhYmxlRnJvbVNxbH0gV0hFUkUgJHtzY29wZUZvcmVpZ25LZXlTcWx9ID0gJHt0YXJnZXRGb3JlaWduS2V5U3FsfSBBTkQgJHtzY29wZUxvY2FsZVNxbH0gSU4gKCR7bG9jYWxlTGlzdFNxbH0pIE9SREVSIEJZICR7ZmFsbGJhY2tPcmRlclNxbH0sICR7c2NvcGVQcmltYXJ5S2V5U3FsfSBBU0MgTElNSVQgMWBcblxuICAgIHJldHVybiBxdWVyeS53aGVyZShgJHt0YXJnZXRQcmltYXJ5S2V5U3FsfSA9ICgke3NlbGVjdGVkVHJhbnNsYXRpb25TcWx9KWApXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdHJhbnNsYXRpb24gY2xhc3MuXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IC0gVGhlIHRyYW5zbGF0aW9uIGNsYXNzLlxuICAgKi9cbiAgc3RhdGljIGdldFRyYW5zbGF0aW9uQ2xhc3MoKSB7XG4gICAgaWYgKHRoaXMuX3RyYW5zbGF0aW9uQ2xhc3MpIHJldHVybiB0aGlzLl90cmFuc2xhdGlvbkNsYXNzXG4gICAgaWYgKHRoaXMudGFibGVOYW1lKCkuZW5kc1dpdGgoXCJfdHJhbnNsYXRpb25zXCIpKSB0aHJvdyBuZXcgRXJyb3IoXCJUcnlpbmcgdG8gZGVmaW5lIGEgdHJhbnNsYXRpb25zIGNsYXNzIGZvciBhIHRyYW5zbGF0aW9uIGNsYXNzXCIpXG5cbiAgICBjb25zdCBjbGFzc05hbWUgPSBgJHt0aGlzLmdldE1vZGVsTmFtZSgpfVRyYW5zbGF0aW9uYFxuICAgIGNvbnN0IFRyYW5zbGF0aW9uQ2xhc3MgPSBjbGFzcyBUcmFuc2xhdGlvbiBleHRlbmRzIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkIHt9XG4gICAgY29uc3QgYmVsb25nc1RvID0gc2luZ3VsYXJpemVNb2RlbE5hbWUoaW5mbGVjdGlvbi5jYW1lbGl6ZSh0aGlzLnRhYmxlTmFtZSgpLCB0cnVlKSlcblxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShUcmFuc2xhdGlvbkNsYXNzLCBcIm5hbWVcIiwge3ZhbHVlOiBjbGFzc05hbWV9KVxuICAgIFRyYW5zbGF0aW9uQ2xhc3Muc2V0VGFibGVOYW1lKHRoaXMuZ2V0VHJhbnNsYXRpb25zVGFibGVOYW1lKCkpXG4gICAgVHJhbnNsYXRpb25DbGFzcy5iZWxvbmdzVG8oYmVsb25nc1RvKVxuXG4gICAgaWYgKHRoaXMuaGFzVGVuYW50RGF0YWJhc2VJZGVudGlmaWVyUmVzb2x2ZXIoKSkge1xuICAgICAgY29uc3QgdHJhbnNsYXRlZE1vZGVsQ2xhc3MgPSB0aGlzXG5cbiAgICAgIFRyYW5zbGF0aW9uQ2xhc3Muc3dpdGNoZXNUZW5hbnREYXRhYmFzZSgoe3RlbmFudH0pID0+IHRyYW5zbGF0ZWRNb2RlbENsYXNzLmdldFRlbmFudERhdGFiYXNlSWRlbnRpZmllcih0ZW5hbnQpKVxuICAgIH1cblxuICAgIHRoaXMuX3RyYW5zbGF0aW9uQ2xhc3MgPSBUcmFuc2xhdGlvbkNsYXNzXG5cbiAgICByZXR1cm4gdGhpcy5fdHJhbnNsYXRpb25DbGFzc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRyYW5zbGF0aW9ucyB0YWJsZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSB0cmFuc2xhdGlvbnMgdGFibGUgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBnZXRUcmFuc2xhdGlvbnNUYWJsZU5hbWUoKSB7XG4gICAgY29uc3QgdGFibGVOYW1lUGFydHMgPSB0aGlzLnRhYmxlTmFtZSgpLnNwbGl0KFwiX1wiKVxuXG4gICAgdGFibGVOYW1lUGFydHNbdGFibGVOYW1lUGFydHMubGVuZ3RoIC0gMV0gPSBpbmZsZWN0aW9uLnNpbmd1bGFyaXplKHRhYmxlTmFtZVBhcnRzW3RhYmxlTmFtZVBhcnRzLmxlbmd0aCAtIDFdKVxuXG4gICAgcmV0dXJuIGAke3RhYmxlTmFtZVBhcnRzLmpvaW4oXCJfXCIpfV90cmFuc2xhdGlvbnNgXG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYXMgdHJhbnNsYXRpb25zIHRhYmxlLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gLSBSZXNvbHZlcyB3aXRoIFdoZXRoZXIgaXQgaGFzIHRyYW5zbGF0aW9ucyB0YWJsZS5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBoYXNUcmFuc2xhdGlvbnNUYWJsZSgpIHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5jb25uZWN0aW9uKCkuZ2V0VGFibGVCeU5hbWUodGhpcy5nZXRUcmFuc2xhdGlvbnNUYWJsZU5hbWUoKSlcblxuICAgICAgcmV0dXJuIHRydWVcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBZGRzIGEgdmFsaWRhdGlvbiB0byBhbiBhdHRyaWJ1dGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIFRoZSBuYW1lIG9mIHRoZSBhdHRyaWJ1dGUgdG8gdmFsaWRhdGUuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgYm9vbGVhbiB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IHZhbGlkYXRvcnMgVGhlIHZhbGlkYXRvcnMgdG8gYWRkLiBLZXkgaXMgdGhlIHZhbGlkYXRvciBuYW1lLCB2YWx1ZSBpcyB0aGUgdmFsaWRhdG9yIGFyZ3VtZW50cy5cbiAgICovXG4gIHN0YXRpYyBhc3luYyB2YWxpZGF0ZXMoYXR0cmlidXRlTmFtZSwgdmFsaWRhdG9ycykge1xuICAgIGZvciAoY29uc3QgdmFsaWRhdG9yTmFtZSBpbiB2YWxpZGF0b3JzKSB7XG4gICAgICAvKipcbiAgICAgICAqIERlZmluZXMgdmFsaWRhdG9yQXJncy5cbiAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgICBsZXQgdmFsaWRhdG9yQXJnc1xuXG4gICAgICAvKipcbiAgICAgICAqIFVzZSB2YWxpZGF0b3IuXG4gICAgICAgKiBAdHlwZSB7Ym9vbGVhbn0gKi9cbiAgICAgIGxldCB1c2VWYWxpZGF0b3IgPSB0cnVlXG5cbiAgICAgIGNvbnN0IHZhbGlkYXRvckFyZ3NDYW5kaWRhdGUgPSB2YWxpZGF0b3JzW3ZhbGlkYXRvck5hbWVdXG5cbiAgICAgIGlmICh0eXBlb2YgdmFsaWRhdG9yQXJnc0NhbmRpZGF0ZSA9PSBcImJvb2xlYW5cIikge1xuICAgICAgICB2YWxpZGF0b3JBcmdzID0ge31cbiAgICAgICAgdXNlVmFsaWRhdG9yXG5cbiAgICAgICAgaWYgKCF2YWxpZGF0b3JBcmdzQ2FuZGlkYXRlKSB7XG4gICAgICAgICAgdXNlVmFsaWRhdG9yID0gZmFsc2VcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdmFsaWRhdG9yQXJncyA9IHZhbGlkYXRvckFyZ3NDYW5kaWRhdGVcbiAgICAgIH1cblxuICAgICAgaWYgKCF1c2VWYWxpZGF0b3IpIHtcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgVmFsaWRhdG9yQ2xhc3MgPSB0aGlzLmdldFZhbGlkYXRvclR5cGUodmFsaWRhdG9yTmFtZSlcbiAgICAgIGNvbnN0IHZhbGlkYXRvciA9IG5ldyBWYWxpZGF0b3JDbGFzcyh7YXR0cmlidXRlTmFtZSwgYXJnczogdmFsaWRhdG9yQXJnc30pXG5cbiAgICAgIGlmICghdGhpcy5fdmFsaWRhdG9ycykgdGhpcy5fdmFsaWRhdG9ycyA9IHt9XG4gICAgICBpZiAoIShhdHRyaWJ1dGVOYW1lIGluIHRoaXMuX3ZhbGlkYXRvcnMpKSB0aGlzLl92YWxpZGF0b3JzW2F0dHJpYnV0ZU5hbWVdID0gW11cblxuICAgICAgdGhpcy5fdmFsaWRhdG9yc1thdHRyaWJ1dGVOYW1lXS5wdXNoKHZhbGlkYXRvcilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGdhcC1sZXNzIHBvc2l0aW9uYWwgbGlzdCBjYWxsYmFja3MgZm9yIGEgY29sdW1uIHNjb3BlZCBieVxuICAgKiBhbm90aGVyIGNvbHVtbi4gSW5zZXJ0cyBhbmQgbW92ZXMgc2hpZnQgc3Vycm91bmRpbmcgcG9zaXRpb25zIHNvIHRoZVxuICAgKiBsaXN0IHN0YXlzIGNvbXBhY3QgKDEsMiwzLC4uLikuIERlc3Ryb3lzIGNsb3NlIHRoZSByZXN1bHRpbmcgZ2FwLlxuICAgKlxuICAgKiBDYWxsZXJzIG11c3QgZW5zdXJlIGEgVU5JUVVFIGluZGV4IG9uIChzY29wZUNvbHVtbiwgcG9zaXRpb25Db2x1bW4pXG4gICAqIGV4aXN0cyBpbiB0aGUgZGF0YWJhc2Ug4oCUIHVzZSBgTWlncmF0aW9uLmFkZEFjdHNBc0xpc3QoKWAgZm9yIHRoZVxuICAgKiBzY2hlbWEgaGFsZi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHBvc2l0aW9uQ29sdW1uIC0gY2FtZWxDYXNlIHBvc2l0aW9uIGF0dHJpYnV0ZSAoZS5nLiBcInJvd051bWJlclwiKS5cbiAgICogQHBhcmFtIHtvYmplY3R9IG9wdGlvbnMgLSBPcHRpb25zIHdpdGggYSByZXF1aXJlZCBzY29wZSBhdHRyaWJ1dGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBvcHRpb25zLnNjb3BlIC0gY2FtZWxDYXNlIHNjb3BlIGF0dHJpYnV0ZSAoZS5nLiBcImJvYXJkQ29sdW1uSWRcIikuXG4gICAqL1xuICBzdGF0aWMgYWN0c0FzTGlzdChwb3NpdGlvbkNvbHVtbiwgb3B0aW9ucykge1xuICAgIGNvbnN0IHtzY29wZX0gPSBvcHRpb25zXG5cbiAgICByZWdpc3RlckFjdHNBc0xpc3RDYWxsYmFja3ModGhpcywgcG9zaXRpb25Db2x1bW4sIHtzY29wZX0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0cmFuc2xhdGlvbnMgbG9hZGVkLlxuICAgKiBAYWJzdHJhY3RcbiAgICogQHJldHVybnMge1RyYW5zbGF0aW9uQmFzZVtdfSAtIFRoZSB0cmFuc2xhdGlvbnMgbG9hZGVkLlxuICAgKi9cbiAgdHJhbnNsYXRpb25zTG9hZGVkKCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcIid0cmFuc2xhdGlvbnNMb2FkZWQnIG5vdCBpbXBsZW1lbnRlZFwiKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRyYW5zbGF0ZWQgYXR0cmlidXRlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIE5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBsb2NhbGUgLSBMb2NhbGUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gVGhlIHRyYW5zbGF0ZWQgYXR0cmlidXRlLCBpZiBmb3VuZC5cbiAgICovXG4gIF9nZXRUcmFuc2xhdGVkQXR0cmlidXRlKG5hbWUsIGxvY2FsZSkge1xuICAgIGNvbnN0IHRyYW5zbGF0aW9uID0gdGhpcy50cmFuc2xhdGlvbnNMb2FkZWQoKS5maW5kKCh0cmFuc2xhdGlvbikgPT4gdHJhbnNsYXRpb24ubG9jYWxlKCkgPT0gbG9jYWxlKVxuXG4gICAgaWYgKHRyYW5zbGF0aW9uKSB7XG4gICAgICAvKipcbiAgICAgICAqIERpY3QuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgICAgY29uc3QgZGljdCA9IHRyYW5zbGF0aW9uXG5cbiAgICAgIGNvbnN0IGF0dHJpYnV0ZU1ldGhvZCA9IC8qKiBAdHlwZSB7KCkgPT4gc3RyaW5nIHwgdW5kZWZpbmVkfSAqLyAoZGljdFtuYW1lXSlcblxuICAgICAgaWYgKHR5cGVvZiBhdHRyaWJ1dGVNZXRob2QgPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgIHJldHVybiBhdHRyaWJ1dGVNZXRob2QuYmluZCh0cmFuc2xhdGlvbikoKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBzdWNoIHRyYW5zbGF0ZWQgbWV0aG9kOiAke25hbWV9ICgke3R5cGVvZiBhdHRyaWJ1dGVNZXRob2R9KWApXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHRyYW5zbGF0ZWQgYXR0cmlidXRlIHdpdGggZmFsbGJhY2suXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGxvY2FsZSAtIExvY2FsZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBUaGUgdHJhbnNsYXRlZCBhdHRyaWJ1dGUgd2l0aCBmYWxsYmFjaywgaWYgZm91bmQuXG4gICAqL1xuICBfZ2V0VHJhbnNsYXRlZEF0dHJpYnV0ZVdpdGhGYWxsYmFjayhuYW1lLCBsb2NhbGUpIHtcbiAgICBsZXQgbG9jYWxlc0luT3JkZXJcbiAgICBjb25zdCBmYWxsYmFja3MgPSB0aGlzLl9nZXRDb25maWd1cmF0aW9uKCkuZ2V0TG9jYWxlRmFsbGJhY2tzKClcblxuICAgIGlmIChmYWxsYmFja3MgJiYgbG9jYWxlIGluIGZhbGxiYWNrcykge1xuICAgICAgbG9jYWxlc0luT3JkZXIgPSBmYWxsYmFja3NbbG9jYWxlXVxuICAgIH0gZWxzZSB7XG4gICAgICBsb2NhbGVzSW5PcmRlciA9IFtsb2NhbGVdXG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBmYWxsYmFja0xvY2FsZSBvZiBsb2NhbGVzSW5PcmRlcikge1xuICAgICAgY29uc3QgcmVzdWx0ID0gdGhpcy5fZ2V0VHJhbnNsYXRlZEF0dHJpYnV0ZShuYW1lLCBmYWxsYmFja0xvY2FsZSlcblxuICAgICAgaWYgKHJlc3VsdCAmJiByZXN1bHQudHJpbSgpICE9IFwiXCIpIHtcbiAgICAgICAgcmV0dXJuIHJlc3VsdFxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCB0cmFuc2xhdGVkIGF0dHJpYnV0ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBOYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbG9jYWxlIC0gTG9jYWxlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBuZXdWYWx1ZSAtIE5ldyB2YWx1ZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX3NldFRyYW5zbGF0ZWRBdHRyaWJ1dGUobmFtZSwgbG9jYWxlLCBuZXdWYWx1ZSkge1xuICAgIC8qKlxuICAgICAqIERlZmluZXMgdHJhbnNsYXRpb24uXG4gICAgICogQHR5cGUge1ZlbG9jaW91c0RhdGFiYXNlUmVjb3JkIHwgVHJhbnNsYXRpb25CYXNlIHwgdW5kZWZpbmVkfSAqL1xuICAgIGxldCB0cmFuc2xhdGlvblxuXG4gICAgdHJhbnNsYXRpb24gPSB0aGlzLnRyYW5zbGF0aW9uc0xvYWRlZCgpPy5maW5kKCh0cmFuc2xhdGlvbikgPT4gdHJhbnNsYXRpb24ubG9jYWxlKCkgPT0gbG9jYWxlKVxuXG4gICAgaWYgKCF0cmFuc2xhdGlvbikge1xuICAgICAgY29uc3QgaW5zdGFuY2VSZWxhdGlvbnNoaXAgPSB0aGlzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShcInRyYW5zbGF0aW9uc1wiKVxuXG4gICAgICB0cmFuc2xhdGlvbiA9IGluc3RhbmNlUmVsYXRpb25zaGlwLmJ1aWxkKHtsb2NhbGV9KVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEFzc2lnbm1lbnRzLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgYXNzaWdubWVudHMgPSB7fVxuXG4gICAgYXNzaWdubWVudHNbbmFtZV0gPSBuZXdWYWx1ZVxuXG4gICAgdHJhbnNsYXRpb24uYXNzaWduKGFzc2lnbm1lbnRzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbmV3IHF1ZXJ5LlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge3tkcml2ZXI/OiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCB8ICgoKSA9PiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCksIG9wZXJhdGlvbj86IGltcG9ydChcIi4uL29wZXJhdGlvbi5qc1wiKS5kZWZhdWx0fX0gW2FyZ3NdIC0gRXhwbGljaXQgcXVlcnkgb3duZXJzaGlwLlxuICAgKiBAcmV0dXJucyB7TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gLSBUaGUgbmV3IHF1ZXJ5LlxuICAgKi9cbiAgc3RhdGljIF9uZXdRdWVyeShhcmdzID0ge30pIHtcbiAgICBjb25zdCB7ZHJpdmVyOiBnaXZlbkRyaXZlciwgb3BlcmF0aW9uOiBnaXZlbk9wZXJhdGlvbiwgLi4ucmVzdEFyZ3N9ID0gYXJnc1xuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG4gICAgY29uc3Qgb3BlcmF0aW9uID0gZ2l2ZW5PcGVyYXRpb24gfHwgdGhpcy5fcmVjb3JkTWV0YWRhdGFPcGVyYXRpb25cbiAgICBjb25zdCBkcml2ZXIgPSBnaXZlbkRyaXZlciB8fCAob3BlcmF0aW9uID8gb3BlcmF0aW9uLmNvbm5lY3Rpb24oKSA6ICgpID0+IHRoaXMuY29ubmVjdGlvbigpKVxuICAgIHRoaXMuX2Fzc2VydEhhc0JlZW5Jbml0aWFsaXplZCgpXG4gICAgY29uc3QgaGFuZGxlciA9IG5ldyBIYW5kbGVyKClcbiAgICBjb25zdCBxdWVyeSA9IG5ldyBNb2RlbENsYXNzUXVlcnkoe1xuICAgICAgZHJpdmVyLFxuICAgICAgaGFuZGxlcixcbiAgICAgIG1vZGVsQ2xhc3M6IHRoaXMsXG4gICAgICBvcGVyYXRpb25cbiAgICB9KVxuXG4gICAgcmV0dXJuIHF1ZXJ5LmZyb20obmV3IEZyb21UYWJsZSh0aGlzLnRhYmxlTmFtZSgpKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9yZGVyYWJsZSBjb2x1bW4uXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIG9yZGVyYWJsZSBjb2x1bW4uXG4gICAqL1xuICBzdGF0aWMgb3JkZXJhYmxlQ29sdW1uKCkge1xuICAgIC8vIEZJWE1FOiBBbGxvdyB0byBjaGFuZ2UgdG8gJ2NyZWF0ZWRfYXQnIGlmIHVzaW5nIFVVSUQ/XG5cbiAgICByZXR1cm4gdGhpcy5wcmltYXJ5S2V5KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFsbC5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHJldHVybnMge01vZGVsQ2xhc3NRdWVyeTxNQz59IC0gVGhlIGFsbC5cbiAgICovXG4gIHN0YXRpYyBhbGwoKSB7XG4gICAgcmV0dXJuIHRoaXMuX25ld1F1ZXJ5KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFjY2Vzc2libGUgZm9yLlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge3N0cmluZ30gYWN0aW9uIC0gQWJpbGl0eSBhY3Rpb24gdG8gc2NvcGUgYnkuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IFthYmlsaXR5XSAtIEFiaWxpdHkgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtNb2RlbENsYXNzUXVlcnk8TUM+fSAtIEF1dGhvcml6ZWQgcXVlcnkuXG4gICAqL1xuICBzdGF0aWMgYWNjZXNzaWJsZUZvcihhY3Rpb24sIGFiaWxpdHkpIHtcbiAgICBjb25zdCBxdWVyeSA9IHRoaXMuX25ld1F1ZXJ5KClcbiAgICBjb25zdCBjdXJyZW50QWJpbGl0eSA9IGFiaWxpdHkgfHwgQ3VycmVudC5hYmlsaXR5KClcblxuICAgIGlmICghY3VycmVudEFiaWxpdHkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gYWJpbGl0eSBpbiBjb250ZXh0IGZvciAke3RoaXMubmFtZX0uIFBhc3MgYW4gYWJpbGl0eSBvciBjb25maWd1cmUgYWJpbGl0eSByZXNvbHZlciBvbiB0aGUgcmVxdWVzdGApXG4gICAgfVxuXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gKi8gKGN1cnJlbnRBYmlsaXR5LmFwcGx5VG9RdWVyeSh7XG4gICAgICBhY3Rpb24sXG4gICAgICBtb2RlbENsYXNzOiB0aGlzLFxuICAgICAgcXVlcnlcbiAgICB9KSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFjY2Vzc2libGUuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9IFthYmlsaXR5XSAtIEFiaWxpdHkgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtNb2RlbENsYXNzUXVlcnk8TUM+fSAtIEF1dGhvcml6ZWQgcXVlcnkuXG4gICAqL1xuICBzdGF0aWMgYWNjZXNzaWJsZShhYmlsaXR5KSB7XG4gICAgcmV0dXJuIHRoaXMuYWNjZXNzaWJsZUZvcihcInJlYWRcIiwgYWJpbGl0eSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFjY2Vzc2libGUgYnkuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vYXV0aG9yaXphdGlvbi9hYmlsaXR5LmpzXCIpLmRlZmF1bHR9IGFiaWxpdHkgLSBBYmlsaXR5IGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gLSBBdXRob3JpemVkIHF1ZXJ5LlxuICAgKi9cbiAgc3RhdGljIGFjY2Vzc2libGVCeShhYmlsaXR5KSB7XG4gICAgaWYgKCFhYmlsaXR5KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGFiaWxpdHkgcGFzc2VkIHRvICR7dGhpcy5uYW1lfS5hY2Nlc3NpYmxlQnkoYWJpbGl0eSkuYClcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5hY2Nlc3NpYmxlKGFiaWxpdHkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb3VudC5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjb3VudC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBjb3VudCgpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9uZXdRdWVyeSgpLmNvdW50KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdyb3VwLlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge3N0cmluZ30gZ3JvdXAgLSBHcm91cC5cbiAgICogQHJldHVybnMge01vZGVsQ2xhc3NRdWVyeTxNQz59IC0gVGhlIGdyb3VwLlxuICAgKi9cbiAgc3RhdGljIGdyb3VwKGdyb3VwKSB7XG4gICAgcmV0dXJuIHRoaXMuX25ld1F1ZXJ5KCkuZ3JvdXAoZ3JvdXApXG4gIH1cblxuICBzdGF0aWMgYXN5bmMgZGVzdHJveUFsbCgpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9uZXdRdWVyeSgpLmRlc3Ryb3lBbGwoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcGx1Y2suXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7Li4uc3RyaW5nfHN0cmluZ1tdfSBjb2x1bW5zIC0gQ29sdW1uIG5hbWVzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIFJlc29sdmVzIHdpdGggdGhlIHBsdWNrLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHBsdWNrKC4uLmNvbHVtbnMpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9uZXdRdWVyeSgpLnBsdWNrKC4uLmNvbHVtbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kLlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge251bWJlcnxzdHJpbmd9IHJlY29yZElkIC0gUmVjb3JkIGlkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8TUM+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBmaW5kLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGZpbmQocmVjb3JkSWQpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9uZXdRdWVyeSgpLmZpbmQocmVjb3JkSWQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIGJ5LlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge3tba2V5OiBzdHJpbmddOiBzdHJpbmcgfCBudW1iZXJ9fSBjb25kaXRpb25zIC0gQ29uZGl0aW9ucyBoYXNoIGtleWVkIGJ5IGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8TUM+IHwgbnVsbD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgYnkuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZmluZEJ5KGNvbmRpdGlvbnMpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9uZXdRdWVyeSgpLmZpbmRCeShjb25kaXRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmluZCBieSBvciBmYWlsLlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge3tba2V5OiBzdHJpbmddOiBzdHJpbmcgfCBudW1iZXJ9fSBjb25kaXRpb25zIC0gQ29uZGl0aW9ucyBoYXNoIGtleWVkIGJ5IGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8TUM+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBieSBvciBmYWlsLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGZpbmRCeU9yRmFpbChjb25kaXRpb25zKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fbmV3UXVlcnkoKS5maW5kQnlPckZhaWwoY29uZGl0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGFuIGltbXV0YWJsZSB0ZW5hbnQtYm91bmQgbW9kZWwgc2NvcGUuIEVhZ2VyIGhlbHBlcnMgYW5kIGV4cGxpY2l0XG4gICAqIGRhdGFiYXNlT3BlcmF0aW9uL3RyYW5zYWN0aW9uIGNhbGxiYWNrcyBleGVjdXRlIGZyb20gYSBjYXB0dXJlZCBwaHlzaWNhbFxuICAgKiBkYXRhYmFzZSBjb25maWd1cmF0aW9uIGluc3RlYWQgb2YgYW1iaWVudCB0ZW5hbnQgc3RhdGUuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7b2JqZWN0fSB0ZW5hbnQgLSBPcmRpbmFyeSBvciBudWxsLXByb3RvdHlwZSBKU09OLWNvbXBhdGlibGUgdGVuYW50IGRlc2NyaXB0b3IgdG8gc2NvcGUgdGhlIG1vZGVsIHRvLlxuICAgKiBAcmV0dXJucyB7VGVuYW50TW9kZWxTY29wZTxNQz59IC0gTW9kZWwgc2NvcGUgYm91bmQgdG8gdGhlIGNhcHR1cmVkIHRlbmFudCBkYXRhYmFzZS5cbiAgICovXG4gIHN0YXRpYyB1c2luZ1RlbmFudCh0ZW5hbnQpIHtcbiAgICByZXR1cm4gbmV3IFRlbmFudE1vZGVsU2NvcGUoe1xuICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5fZ2V0Q29uZmlndXJhdGlvbigpLFxuICAgICAgbW9kZWxDbGFzczogdGhpcyxcbiAgICAgIHRlbmFudFxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIG9yIGNyZWF0ZSBieS5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHBhcmFtIHt7W2tleTogc3RyaW5nXTogc3RyaW5nIHwgbnVtYmVyfX0gY29uZGl0aW9ucyAtIENvbmRpdGlvbnMgaGFzaCBrZXllZCBieSBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHsoKSA9PiB2b2lkfSBbY2FsbGJhY2tdIC0gQ2FsbGJhY2sgZnVuY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxNQz4+fSAtIFJlc29sdmVzIHdpdGggdGhlIG9yIGNyZWF0ZSBieS5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBmaW5kT3JDcmVhdGVCeShjb25kaXRpb25zLCBjYWxsYmFjaykge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlSW5pdGlhbGl6ZWQoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX25ld1F1ZXJ5KCkuZmluZE9yQ3JlYXRlQnkoY29uZGl0aW9ucywgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIG9yIGluaXRpYWxpemUgYnkuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVtYmVyPn0gY29uZGl0aW9ucyAtIENvbmRpdGlvbnMuXG4gICAqIEBwYXJhbSB7KGFyZzogSW5zdGFuY2VUeXBlPE1DPikgPT4gdm9pZH0gW2NhbGxiYWNrXSAtIENhbGxiYWNrIGZ1bmN0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8TUM+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBvciBpbml0aWFsaXplIGJ5LlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGZpbmRPckluaXRpYWxpemVCeShjb25kaXRpb25zLCBjYWxsYmFjaykge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlSW5pdGlhbGl6ZWQoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX25ld1F1ZXJ5KCkuZmluZE9ySW5pdGlhbGl6ZUJ5KGNvbmRpdGlvbnMsIGNhbGxiYWNrKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmlyc3QuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxNQz4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGZpcnN0LlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGZpcnN0KCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlSW5pdGlhbGl6ZWQoKVxuXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5fbmV3UXVlcnkoKS5maXJzdCgpXG5cbiAgICBpZiAoIXJlc3VsdCkgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMubmFtZX0uZmlyc3QoKSByZXR1cm5lZCBubyByZWNvcmRzYClcblxuICAgIHJldHVybiByZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGpvaW5zLlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge3N0cmluZyB8IGltcG9ydChcIi4uL3F1ZXJ5L2pvaW4tb2JqZWN0LmpzXCIpLkpvaW5PYmplY3R9IGpvaW4gLSBKb2luIGNsYXVzZSBvciBqb2luIGRlc2NyaXB0b3IuXG4gICAqIEByZXR1cm5zIHtNb2RlbENsYXNzUXVlcnk8TUM+fSAtIFRoZSBqb2lucy5cbiAgICovXG4gIHN0YXRpYyBqb2lucyhqb2luKSB7XG4gICAgcmV0dXJuIHRoaXMuX25ld1F1ZXJ5KCkuam9pbnMoam9pbilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxhc3QuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxNQz4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGxhc3QuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgbGFzdCgpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuX25ld1F1ZXJ5KCkubGFzdCgpXG5cbiAgICBpZiAoIXJlc3VsdCkgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMubmFtZX0ubGFzdCgpIHJldHVybmVkIG5vIHJlY29yZHNgKVxuXG4gICAgcmV0dXJuIHJlc3VsdFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbGltaXQuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7bnVtYmVyfSB2YWx1ZSAtIFZhbHVlIHRvIHVzZS5cbiAgICogQHJldHVybnMge01vZGVsQ2xhc3NRdWVyeTxNQz59IC0gVGhlIGxpbWl0LlxuICAgKi9cbiAgc3RhdGljIGxpbWl0KHZhbHVlKSB7XG4gICAgcmV0dXJuIHRoaXMuX25ld1F1ZXJ5KCkubGltaXQodmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBvcmRlci5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9xdWVyeS9pbmRleC5qc1wiKS5PcmRlckFyZ3VtZW50VHlwZX0gb3JkZXIgLSBPcmRlci5cbiAgICogQHJldHVybnMge01vZGVsQ2xhc3NRdWVyeTxNQz59IC0gVGhlIG9yZGVyLlxuICAgKi9cbiAgc3RhdGljIG9yZGVyKG9yZGVyKSB7XG4gICAgcmV0dXJuIHRoaXMuX25ld1F1ZXJ5KCkub3JkZXIob3JkZXIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkaXN0aW5jdC5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHBhcmFtIHtib29sZWFufSBbdmFsdWVdIC0gVmFsdWUgdG8gdXNlLlxuICAgKiBAcmV0dXJucyB7TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gLSBUaGUgZGlzdGluY3QuXG4gICAqL1xuICBzdGF0aWMgZGlzdGluY3QodmFsdWUgPSB0cnVlKSB7XG4gICAgcmV0dXJuIHRoaXMuX25ld1F1ZXJ5KCkuZGlzdGluY3QodmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwcmVsb2FkLlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmQgfCBzdHJpbmcgfCBBcnJheTxzdHJpbmcgfCBpbXBvcnQoXCIuLi9xdWVyeS9pbmRleC5qc1wiKS5OZXN0ZWRQcmVsb2FkUmVjb3JkPn0gcHJlbG9hZCAtIFByZWxvYWQuXG4gICAqIEByZXR1cm5zIHtNb2RlbENsYXNzUXVlcnk8TUM+fSAtIFRoZSBwcmVsb2FkLlxuICAgKi9cbiAgc3RhdGljIHByZWxvYWQocHJlbG9hZCkge1xuICAgIGNvbnN0IHF1ZXJ5ID0gLyoqIEB0eXBlIHtNb2RlbENsYXNzUXVlcnk8TUM+fSAqLyAodGhpcy5fbmV3UXVlcnkoKS5wcmVsb2FkKHByZWxvYWQpKVxuXG4gICAgcmV0dXJuIHF1ZXJ5XG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZWxlY3QuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vcXVlcnkvaW5kZXguanNcIikuU2VsZWN0QXJndW1lbnRUeXBlfSBzZWxlY3QgLSBTZWxlY3QuXG4gICAqIEByZXR1cm5zIHtNb2RlbENsYXNzUXVlcnk8TUM+fSAtIFRoZSBzZWxlY3QuXG4gICAqL1xuICBzdGF0aWMgc2VsZWN0KHNlbGVjdCkge1xuICAgIHJldHVybiB0aGlzLl9uZXdRdWVyeSgpLnNlbGVjdChzZWxlY3QpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0byBhcnJheS5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPE1DPltdPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBhcnJheS5cbiAgICovXG4gIHN0YXRpYyBhc3luYyB0b0FycmF5KCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlSW5pdGlhbGl6ZWQoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX25ld1F1ZXJ5KCkudG9BcnJheSgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBsb2FkLlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8TUM+W10+fSAtIFJlc29sdmVzIHdpdGggdGhlIGFycmF5LlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGxvYWQoKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fbmV3UXVlcnkoKS5sb2FkKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHdoZXJlLlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3F1ZXJ5L2luZGV4LmpzXCIpLldoZXJlQXJndW1lbnRUeXBlfSB3aGVyZSAtIFdoZXJlLlxuICAgKiBAcmV0dXJucyB7TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gLSBUaGUgd2hlcmUuXG4gICAqL1xuICBzdGF0aWMgd2hlcmUod2hlcmUpIHtcbiAgICByZXR1cm4gdGhpcy5fbmV3UXVlcnkoKS53aGVyZSh3aGVyZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJhbnNhY2suXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBwYXJhbXMgLSBSYW5zYWNrLXN0eWxlIHBhcmFtcyBoYXNoLlxuICAgKiBAcmV0dXJucyB7TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gLSBRdWVyeSB3aXRoIFJhbnNhY2sgZmlsdGVycyBhcHBsaWVkLlxuICAgKi9cbiAgc3RhdGljIHJhbnNhY2socGFyYW1zKSB7XG4gICAgcmV0dXJuIHRoaXMuX25ld1F1ZXJ5KCkucmFuc2FjayhwYXJhbXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtXcml0ZUF0dHJpYnV0ZXN9IGNoYW5nZXMgLSBDaGFuZ2VzLlxuICAgKi9cbiAgY29uc3RydWN0b3IoY2hhbmdlcyA9IC8qKiBAdHlwZSB7V3JpdGVBdHRyaWJ1dGVzfSAqLyAoe30pKSB7XG4gICAgY29uc3QgTW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSAqLyAobmV3LnRhcmdldClcblxuICAgIHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uID0gTW9kZWxDbGFzcy5fcmVjb3JkTWV0YWRhdGFPcGVyYXRpb25cbiAgICB0aGlzLmdldE1vZGVsQ2xhc3MoKS5fYXNzZXJ0SGFzQmVlbkluaXRpYWxpemVkKClcbiAgICB0aGlzLl9hdHRyaWJ1dGVzID0ge31cbiAgICB0aGlzLl9jaGFuZ2VzID0ge31cbiAgICB0aGlzLl9pc05ld1JlY29yZCA9IHRydWVcblxuICAgIGZvciAoY29uc3Qga2V5IGluIGNoYW5nZXMpIHtcbiAgICAgIHRoaXMuc2V0QXR0cmlidXRlKGtleSwgY2hhbmdlc1trZXldKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBCaW5kcyBmdXR1cmUgcXVlcnksIGxpZmVjeWNsZSwgcmVsYXRpb25zaGlwLCBhbmQgcGVyc2lzdGVuY2Ugd29yayB0byBhbiBvcGVyYXRpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vb3BlcmF0aW9uLmpzXCIpLmRlZmF1bHR9IG9wZXJhdGlvbiAtIE93bmluZyBvcGVyYXRpb24uXG4gICAqIEByZXR1cm5zIHt0aGlzfSAtIEJvdW5kIHJlY29yZC5cbiAgICovXG4gIGJpbmREYXRhYmFzZU9wZXJhdGlvbihvcGVyYXRpb24pIHtcbiAgICBpZiAodGhpcy5fZGF0YWJhc2VPcGVyYXRpb24gJiYgdGhpcy5fZGF0YWJhc2VPcGVyYXRpb24gIT09IG9wZXJhdGlvbikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUmVjb3JkIGlzIGFscmVhZHkgYm91bmQgdG8gYW5vdGhlciBkYXRhYmFzZSBvcGVyYXRpb25cIilcbiAgICB9XG5cbiAgICB0aGlzLl9kYXRhYmFzZU9wZXJhdGlvbiA9IG9wZXJhdGlvblxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBDYXB0dXJlcyBhbmQgdmFsaWRhdGVzIHRoZSBwaHlzaWNhbCBkYXRhYmFzZSBpZGVudGl0eSB0aGF0IG93bnMgdGhpcyByZWNvcmQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkYXRhYmFzZUlkZW50aXR5IC0gT3BhcXVlIG9wZXJhdGlvbi9jb25uZWN0aW9uIGlkZW50aXR5LlxuICAgKiBAcmV0dXJucyB7dGhpc30gVGhpcyByZWNvcmQuXG4gICAqL1xuICBjYXB0dXJlRGF0YWJhc2VJZGVudGl0eShkYXRhYmFzZUlkZW50aXR5KSB7XG4gICAgaWYgKHRoaXMuX2RhdGFiYXNlSWRlbnRpdHkgJiYgdGhpcy5fZGF0YWJhc2VJZGVudGl0eSAhPT0gZGF0YWJhc2VJZGVudGl0eSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUmVjb3JkIGJlbG9uZ3MgdG8gYSBkaWZmZXJlbnQgcGh5c2ljYWwgdGVuYW50IGRhdGFiYXNlXCIpXG4gICAgfVxuXG4gICAgdGhpcy5fZGF0YWJhc2VJZGVudGl0eSA9IGRhdGFiYXNlSWRlbnRpdHlcblxuICAgIHJldHVybiB0aGlzXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgY2FwdHVyZWQgcGh5c2ljYWwgZGF0YWJhc2UgaWRlbnRpdHkuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IENhcHR1cmVkIHBoeXNpY2FsIGRhdGFiYXNlIGlkZW50aXR5LlxuICAgKi9cbiAgZGF0YWJhc2VJZGVudGl0eSgpIHtcbiAgICByZXR1cm4gdGhpcy5fZGF0YWJhc2VJZGVudGl0eVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbGVhc2VzIHRoaXMgcmVjb3JkIGZyb20gYSBjb21wbGV0ZWQgZWFnZXItaGVscGVyIG9wZXJhdGlvbiB3aGlsZVxuICAgKiBwcmVzZXJ2aW5nIHRoZSBsZWdhY3kgYW1iaWVudCBmb2xsb3ctdXAgYmVoYXZpb3Igb2YgYHVzaW5nVGVuYW50YCBmaW5kZXJzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL29wZXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBvcGVyYXRpb24gLSBSZWxlYXNpbmcgb3BlcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7dGhpc30gLSBSZWNvcmQuXG4gICAqL1xuICByZWxlYXNlRGF0YWJhc2VPcGVyYXRpb24ob3BlcmF0aW9uKSB7XG4gICAgaWYgKHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uICE9PSBvcGVyYXRpb24pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlJlY29yZCBpcyBub3QgYm91bmQgdG8gdGhlIHJlbGVhc2luZyBkYXRhYmFzZSBvcGVyYXRpb25cIilcbiAgICB9XG5cbiAgICB0aGlzLl9kYXRhYmFzZU9wZXJhdGlvbiA9IHVuZGVmaW5lZFxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBleHBsaWNpdCBvcGVyYXRpb24gb3duaW5nIHRoaXMgcmVjb3JkLCBpZiBhbnkuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9vcGVyYXRpb24uanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBPd25pbmcgb3BlcmF0aW9uLlxuICAgKi9cbiAgZGF0YWJhc2VPcGVyYXRpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uXG4gIH1cblxuICAvKipcbiAgICogQmluZHMgYSByZWxhdGVkIHJlY29yZCB0byB0aGUgc2FtZSBvcGVyYXRpb24gYXMgdGhpcyByZWNvcmQuXG4gICAqIEB0ZW1wbGF0ZSB7VmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1vZGVsXG4gICAqIEBwYXJhbSB7TW9kZWx9IHJlY29yZCAtIFJlbGF0ZWQgcmVjb3JkLlxuICAgKiBAcmV0dXJucyB7TW9kZWx9IC0gUmVsYXRlZCByZWNvcmQuXG4gICAqL1xuICBiaW5kUmVsYXRlZFJlY29yZChyZWNvcmQpIHtcbiAgICBpZiAodGhpcy5fZGF0YWJhc2VPcGVyYXRpb24pIHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uLmJpbmRSZWNvcmQocmVjb3JkKVxuXG4gICAgcmV0dXJuIHJlY29yZFxuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIG1vZGVsIHF1ZXJ5IHByZXNlcnZpbmcgdGhpcyByZWNvcmQncyBvcGVyYXRpb24gb3duZXJzaGlwLlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHBhcmFtIHtNQ30gTW9kZWxDbGFzcyAtIFRhcmdldCBtb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge01vZGVsQ2xhc3NRdWVyeTxNQz59IC0gVGFyZ2V0IHF1ZXJ5LlxuICAgKi9cbiAgcXVlcnlGb3JNb2RlbChNb2RlbENsYXNzKSB7XG4gICAgaWYgKHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uKSByZXR1cm4gdGhpcy5fZGF0YWJhc2VPcGVyYXRpb24uZm9yTW9kZWwoTW9kZWxDbGFzcylcblxuICAgIHJldHVybiBNb2RlbENsYXNzLl9uZXdRdWVyeSgpXG4gIH1cblxuICAvKipcbiAgICogSW5pdGlhbGl6ZXMgYSByZWxhdGlvbnNoaXAvcHJlbG9hZCB0YXJnZXQgd2l0aG91dCBkcm9wcGluZyB0aGlzIHJlY29yZCdzXG4gICAqIGV4cGxpY2l0IG9wZXJhdGlvbiBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTW9kZWxDbGFzcyAtIFRhcmdldCBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGNvbmZpZ3VyYXRpb24gLSBPd25pbmcgY29uZmlndXJhdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBpbml0aWFsaXplZC5cbiAgICovXG4gIGFzeW5jIGVuc3VyZU1vZGVsQ2xhc3NJbml0aWFsaXplZChNb2RlbENsYXNzLCBjb25maWd1cmF0aW9uKSB7XG4gICAgaWYgKHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uKSB7XG4gICAgICBhd2FpdCB0aGlzLl9kYXRhYmFzZU9wZXJhdGlvbi5lbnN1cmVNb2RlbEluaXRpYWxpemVkKE1vZGVsQ2xhc3MpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCBNb2RlbENsYXNzLmVuc3VyZUluaXRpYWxpemVkKHtjb25maWd1cmF0aW9ufSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxvYWQgZXhpc3RpbmcgcmVjb3JkLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXR0cmlidXRlcyAtIEF0dHJpYnV0ZXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGxvYWRFeGlzdGluZ1JlY29yZChhdHRyaWJ1dGVzKSB7XG4gICAgdGhpcy5fYXR0cmlidXRlcyA9IGF0dHJpYnV0ZXNcbiAgICB0aGlzLl9pc05ld1JlY29yZCA9IGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogQXNzaWducyB0aGUgZ2l2ZW4gYXR0cmlidXRlcyB0byB0aGUgcmVjb3JkLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXR0cmlidXRlc1RvQXNzaWduIC0gQXR0cmlidXRlcyB0byBhc3NpZ24uXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGFzc2lnbihhdHRyaWJ1dGVzVG9Bc3NpZ24pIHtcbiAgICB0aGlzLl9hc3NpZ25lZEF0dHJpYnV0ZU5hbWVzIHx8PSBuZXcgU2V0KClcbiAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZVRvQXNzaWduIGluIGF0dHJpYnV0ZXNUb0Fzc2lnbikge1xuICAgICAgdGhpcy5fYXNzaWduZWRBdHRyaWJ1dGVOYW1lcy5hZGQoYXR0cmlidXRlVG9Bc3NpZ24pXG4gICAgICB0aGlzLnNldEF0dHJpYnV0ZShhdHRyaWJ1dGVUb0Fzc2lnbiwgYXR0cmlidXRlc1RvQXNzaWduW2F0dHJpYnV0ZVRvQXNzaWduXSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBhIHRoZSBjdXJyZW50IGF0dHJpYnV0ZXMgb2YgdGhlIHJlY29yZCAob3JpZ2luYWwgYXR0cmlidXRlcyBmcm9tIGRhdGFiYXNlIHBsdXMgY2hhbmdlcylcbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBUaGUgYXR0cmlidXRlcy5cbiAgICovXG4gIGF0dHJpYnV0ZXMoKSB7XG4gICAgY29uc3QgZGF0YSA9IHRoaXMucmF3QXR0cmlidXRlcygpXG4gICAgY29uc3QgY29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZSA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldENvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXAoKVxuICAgIC8qKlxuICAgICAqIEF0dHJpYnV0ZXMuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBhdHRyaWJ1dGVzID0ge31cblxuICAgIGZvciAoY29uc3QgY29sdW1uTmFtZSBpbiBkYXRhKSB7XG4gICAgICBjb25zdCBhdHRyaWJ1dGVOYW1lID0gY29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZVtjb2x1bW5OYW1lXSB8fCBjb2x1bW5OYW1lXG5cbiAgICAgIGF0dHJpYnV0ZXNbYXR0cmlidXRlTmFtZV0gPSB0aGlzLnJlYWRBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSlcbiAgICB9XG5cbiAgICByZXR1cm4gYXR0cmlidXRlc1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgY29sdW1uLW5hbWUga2V5ZWQgZGF0YSAob3JpZ2luYWwgYXR0cmlidXRlcyBmcm9tIGRhdGFiYXNlIHBsdXMgY2hhbmdlcylcbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBUaGUgcmF3IGF0dHJpYnV0ZXMuXG4gICAqL1xuICByYXdBdHRyaWJ1dGVzKCkge1xuICAgIHJldHVybiBPYmplY3QuYXNzaWduKHt9LCB0aGlzLl9hdHRyaWJ1dGVzLCB0aGlzLl9jaGFuZ2VzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSAtIFRoZSBjb25uZWN0aW9uLlxuICAgKi9cbiAgX2Nvbm5lY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uKSByZXR1cm4gdGhpcy5fZGF0YWJhc2VPcGVyYXRpb24uY29ubmVjdGlvbigpXG4gICAgaWYgKHRoaXMuX19jb25uZWN0aW9uKSByZXR1cm4gdGhpcy5fX2Nvbm5lY3Rpb25cblxuICAgIGNvbnN0IGNvbm5lY3Rpb24gPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5jb25uZWN0aW9uKClcblxuICAgIGlmICh0aGlzLl9kYXRhYmFzZUlkZW50aXR5KSB0aGlzLmNhcHR1cmVEYXRhYmFzZUlkZW50aXR5KHRoaXMuX2RhdGFiYXNlSWRlbnRpdHlGb3JDb25uZWN0aW9uKGNvbm5lY3Rpb24pKVxuXG4gICAgcmV0dXJuIGNvbm5lY3Rpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyB0aGUgaWRlbnRpdHkgb2YgYW4gYWxyZWFkeSBzZWxlY3RlZCBjb25jcmV0ZSBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBjb25uZWN0aW9uIC0gQ29uY3JldGUgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge3N0cmluZ30gUGh5c2ljYWwgZGF0YWJhc2UgaWRlbnRpdHkuXG4gICAqL1xuICBfZGF0YWJhc2VJZGVudGl0eUZvckNvbm5lY3Rpb24oY29ubmVjdGlvbikge1xuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKVxuICAgIGNvbnN0IGRhdGFiYXNlSWRlbnRpZmllciA9IG1vZGVsQ2xhc3MuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKClcbiAgICBjb25zdCByZXVzZUtleSA9IG1vZGVsQ2xhc3NcbiAgICAgIC5fZ2V0Q29uZmlndXJhdGlvbigpXG4gICAgICAuZ2V0RGF0YWJhc2VQb29sKGRhdGFiYXNlSWRlbnRpZmllcilcbiAgICAgIC5nZXRDb25uZWN0aW9uQ29uZmlndXJhdGlvblJldXNlS2V5KGNvbm5lY3Rpb24pXG5cbiAgICByZXR1cm4gYCR7ZGF0YWJhc2VJZGVudGlmaWVyfToke3JldXNlS2V5fWBcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBjb25uZWN0aW9uIHRoYXQgb3ducyB0aGlzIHJlY29yZCdzIGRhdGFiYXNlIHdvcmsuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gLSBDb25uZWN0aW9uLlxuICAgKi9cbiAgY29ubmVjdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5fY29ubmVjdGlvbigpXG4gIH1cblxuICAvKipcbiAgICogQ291bnRzIGRlcGVuZGVudCByZWNvcmRzIGZvciBhIGBkZXBlbmRlbnQ6IFwicmVzdHJpY3RcImAgcmVsYXRpb25zaGlwLlxuICAgKiBAcGFyYW0ge1Jlc3RyaWN0SW5zdGFuY2VSZWxhdGlvbnNoaXB9IGluc3RhbmNlUmVsYXRpb25zaGlwIC0gUmVsYXRpb25zaGlwIGluc3RhbmNlIHRvIGNvdW50LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIERlcGVuZGVudCByb3cgY291bnQuXG4gICAqL1xuICBhc3luYyBfZGVwZW5kZW50UmVzdHJpY3RDb3VudChpbnN0YW5jZVJlbGF0aW9uc2hpcCkge1xuICAgIGNvbnN0IFRhcmdldE1vZGVsQ2xhc3MgPSBpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRUYXJnZXRNb2RlbENsYXNzKClcblxuICAgIGlmICghVGFyZ2V0TW9kZWxDbGFzcyB8fCAhVGFyZ2V0TW9kZWxDbGFzcy5oYXNUZW5hbnREYXRhYmFzZUlkZW50aWZpZXJSZXNvbHZlcigpKSB7XG4gICAgICByZXR1cm4gYXdhaXQgaW5zdGFuY2VSZWxhdGlvbnNoaXAucXVlcnkoKS5jb3VudCgpXG4gICAgfVxuXG4gICAgaWYgKHRoaXMuZ2V0TW9kZWxDbGFzcygpLmhhc1RlbmFudERhdGFiYXNlSWRlbnRpZmllclJlc29sdmVyKCkpIHtcbiAgICAgIHJldHVybiBhd2FpdCBpbnN0YW5jZVJlbGF0aW9uc2hpcC5xdWVyeSgpLmNvdW50KClcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fZGVwZW5kZW50UmVzdHJpY3RUZW5hbnRDb3VudChpbnN0YW5jZVJlbGF0aW9uc2hpcCwgVGFyZ2V0TW9kZWxDbGFzcylcbiAgfVxuXG4gIC8qKlxuICAgKiBDb3VudHMgdGVuYW50LXNjb3BlZCBkZXBlbmRlbnQgcmVjb3JkcyBhY3Jvc3MgYWxsIHByb3ZpZGVyLWxpc3RlZCB0ZW5hbnRzLlxuICAgKiBAcGFyYW0ge1Jlc3RyaWN0SW5zdGFuY2VSZWxhdGlvbnNoaXB9IGluc3RhbmNlUmVsYXRpb25zaGlwIC0gUmVsYXRpb25zaGlwIGluc3RhbmNlIHRvIGNvdW50LlxuICAgKiBAcGFyYW0ge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gVGFyZ2V0TW9kZWxDbGFzcyAtIFJlbGF0ZWQgbW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gRGVwZW5kZW50IHJvdyBjb3VudC5cbiAgICovXG4gIGFzeW5jIF9kZXBlbmRlbnRSZXN0cmljdFRlbmFudENvdW50KGluc3RhbmNlUmVsYXRpb25zaGlwLCBUYXJnZXRNb2RlbENsYXNzKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLl9nZXRDb25maWd1cmF0aW9uKClcbiAgICBjb25zdCB0ZW5hbnREYXRhYmFzZVByb3ZpZGVycyA9IGNvbmZpZ3VyYXRpb24uZ2V0VGVuYW50RGF0YWJhc2VQcm92aWRlcnMoKVxuICAgIGNvbnN0IHByb3ZpZGVyRW50cmllcyA9IE9iamVjdC5lbnRyaWVzKHRlbmFudERhdGFiYXNlUHJvdmlkZXJzKVxuICAgIGNvbnN0IHRhcmdldElkZW50aWZpZXIgPSBUYXJnZXRNb2RlbENsYXNzLmdldFRlbmFudERhdGFiYXNlSWRlbnRpZmllcihudWxsKVxuXG4gICAgaWYgKHByb3ZpZGVyRW50cmllcy5sZW5ndGggPT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgY2hlY2sgZGVwZW5kZW50ICR7aW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0UmVsYXRpb25zaGlwKCkuZ2V0UmVsYXRpb25zaGlwTmFtZSgpfSBiZWNhdXNlICR7VGFyZ2V0TW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKX0gc3dpdGNoZXMgdGVuYW50IGRhdGFiYXNlcyBidXQgbm8gdGVuYW50IGRhdGFiYXNlIHByb3ZpZGVycyBhcmUgY29uZmlndXJlZGApXG4gICAgfVxuXG4gICAgaWYgKHRhcmdldElkZW50aWZpZXIpIHtcbiAgICAgIGNvbnN0IHByb3ZpZGVyID0gdGVuYW50RGF0YWJhc2VQcm92aWRlcnNbdGFyZ2V0SWRlbnRpZmllcl1cblxuICAgICAgaWYgKCFwcm92aWRlcikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBjaGVjayBkZXBlbmRlbnQgJHtpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRSZWxhdGlvbnNoaXAoKS5nZXRSZWxhdGlvbnNoaXBOYW1lKCl9IGJlY2F1c2UgJHtUYXJnZXRNb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpfSBzd2l0Y2hlcyB0ZW5hbnQgZGF0YWJhc2UgJHt0YXJnZXRJZGVudGlmaWVyfSBidXQgbm8gdGVuYW50IGRhdGFiYXNlIHByb3ZpZGVyIGlzIGNvbmZpZ3VyZWQgZm9yICR7dGFyZ2V0SWRlbnRpZmllcn1gKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5fZGVwZW5kZW50UmVzdHJpY3RQcm92aWRlckNvdW50KGluc3RhbmNlUmVsYXRpb25zaGlwLCBUYXJnZXRNb2RlbENsYXNzLCB0YXJnZXRJZGVudGlmaWVyLCBwcm92aWRlcilcbiAgICB9XG5cbiAgICBsZXQgbWF0Y2hpbmdQcm92aWRlclNlZW4gPSBmYWxzZVxuXG4gICAgZm9yIChjb25zdCBbaWRlbnRpZmllciwgcHJvdmlkZXJdIG9mIHByb3ZpZGVyRW50cmllcykge1xuICAgICAgY29uc3QgdGVuYW50cyA9IGF3YWl0IHRoaXMuX2RlcGVuZGVudFJlc3RyaWN0UHJvdmlkZXJUZW5hbnRzKGluc3RhbmNlUmVsYXRpb25zaGlwLCBUYXJnZXRNb2RlbENsYXNzLCBpZGVudGlmaWVyLCBwcm92aWRlcilcblxuICAgICAgZm9yIChjb25zdCB0ZW5hbnQgb2YgdGVuYW50cykge1xuICAgICAgICBpZiAoVGFyZ2V0TW9kZWxDbGFzcy5nZXRUZW5hbnREYXRhYmFzZUlkZW50aWZpZXIodGVuYW50KSAhPSBpZGVudGlmaWVyKSB7XG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuXG4gICAgICAgIG1hdGNoaW5nUHJvdmlkZXJTZWVuID0gdHJ1ZVxuXG4gICAgICAgIGNvbnN0IGNvdW50ID0gYXdhaXQgY29uZmlndXJhdGlvbi5ydW5XaXRoVGVuYW50KHRlbmFudCwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGlmICghY29uZmlndXJhdGlvbi5pc0RhdGFiYXNlSWRlbnRpZmllckFjdGl2ZShpZGVudGlmaWVyKSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBUZW5hbnQgZGF0YWJhc2UgaWRlbnRpZmllciAke2lkZW50aWZpZXJ9IGlzIGluYWN0aXZlIHdoaWxlIGNoZWNraW5nIGRlcGVuZGVudCAke2luc3RhbmNlUmVsYXRpb25zaGlwLmdldFJlbGF0aW9uc2hpcCgpLmdldFJlbGF0aW9uc2hpcE5hbWUoKX1gKVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHJldHVybiBhd2FpdCBjb25maWd1cmF0aW9uLmVuc3VyZUNvbm5lY3Rpb25zKHtkYXRhYmFzZUlkZW50aWZpZXJzOiBbaWRlbnRpZmllcl0sIG5hbWU6IGBEZXBlbmRlbnQgcmVzdHJpY3QgY291bnQ6ICR7VGFyZ2V0TW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKX1gfSwgYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIGF3YWl0IGluc3RhbmNlUmVsYXRpb25zaGlwLnF1ZXJ5KCkuY291bnQoKVxuICAgICAgICAgIH0pXG4gICAgICAgIH0pXG5cbiAgICAgICAgaWYgKGNvdW50ID4gMCkgcmV0dXJuIGNvdW50XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCFtYXRjaGluZ1Byb3ZpZGVyU2Vlbikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgY2hlY2sgZGVwZW5kZW50ICR7aW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0UmVsYXRpb25zaGlwKCkuZ2V0UmVsYXRpb25zaGlwTmFtZSgpfSBiZWNhdXNlIG5vIHRlbmFudCBkYXRhYmFzZSBwcm92aWRlciBtYXRjaGVkICR7VGFyZ2V0TW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKX1gKVxuICAgIH1cblxuICAgIHJldHVybiAwXG4gIH1cblxuICAvKipcbiAgICogQ291bnRzIHRlbmFudC1zY29wZWQgZGVwZW5kZW50IHJlY29yZHMgZm9yIG9uZSBjb25maWd1cmVkIHRlbmFudCBwcm92aWRlci5cbiAgICogQHBhcmFtIHtSZXN0cmljdEluc3RhbmNlUmVsYXRpb25zaGlwfSBpbnN0YW5jZVJlbGF0aW9uc2hpcCAtIFJlbGF0aW9uc2hpcCBpbnN0YW5jZSB0byBjb3VudC5cbiAgICogQHBhcmFtIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IFRhcmdldE1vZGVsQ2xhc3MgLSBSZWxhdGVkIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gaWRlbnRpZmllciAtIFRlbmFudCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge1RlbmFudERhdGFiYXNlUHJvdmlkZXJUeXBlfSBwcm92aWRlciAtIFRlbmFudCBkYXRhYmFzZSBwcm92aWRlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBEZXBlbmRlbnQgcm93IGNvdW50LlxuICAgKi9cbiAgYXN5bmMgX2RlcGVuZGVudFJlc3RyaWN0UHJvdmlkZXJDb3VudChpbnN0YW5jZVJlbGF0aW9uc2hpcCwgVGFyZ2V0TW9kZWxDbGFzcywgaWRlbnRpZmllciwgcHJvdmlkZXIpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5nZXRNb2RlbENsYXNzKCkuX2dldENvbmZpZ3VyYXRpb24oKVxuICAgIGNvbnN0IHRlbmFudHMgPSBhd2FpdCB0aGlzLl9kZXBlbmRlbnRSZXN0cmljdFByb3ZpZGVyVGVuYW50cyhpbnN0YW5jZVJlbGF0aW9uc2hpcCwgVGFyZ2V0TW9kZWxDbGFzcywgaWRlbnRpZmllciwgcHJvdmlkZXIpXG5cbiAgICBmb3IgKGNvbnN0IHRlbmFudCBvZiB0ZW5hbnRzKSB7XG4gICAgICBjb25zdCBjb3VudCA9IGF3YWl0IGNvbmZpZ3VyYXRpb24ucnVuV2l0aFRlbmFudCh0ZW5hbnQsIGFzeW5jICgpID0+IHtcbiAgICAgICAgaWYgKCFjb25maWd1cmF0aW9uLmlzRGF0YWJhc2VJZGVudGlmaWVyQWN0aXZlKGlkZW50aWZpZXIpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBUZW5hbnQgZGF0YWJhc2UgaWRlbnRpZmllciAke2lkZW50aWZpZXJ9IGlzIGluYWN0aXZlIHdoaWxlIGNoZWNraW5nIGRlcGVuZGVudCAke2luc3RhbmNlUmVsYXRpb25zaGlwLmdldFJlbGF0aW9uc2hpcCgpLmdldFJlbGF0aW9uc2hpcE5hbWUoKX1gKVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGF3YWl0IGNvbmZpZ3VyYXRpb24uZW5zdXJlQ29ubmVjdGlvbnMoe2RhdGFiYXNlSWRlbnRpZmllcnM6IFtpZGVudGlmaWVyXSwgbmFtZTogYERlcGVuZGVudCByZXN0cmljdCBjb3VudDogJHtUYXJnZXRNb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpfWB9LCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgcmV0dXJuIGF3YWl0IGluc3RhbmNlUmVsYXRpb25zaGlwLnF1ZXJ5KCkuY291bnQoKVxuICAgICAgICB9KVxuICAgICAgfSlcblxuICAgICAgaWYgKGNvdW50ID4gMCkgcmV0dXJuIGNvdW50XG4gICAgfVxuXG4gICAgcmV0dXJuIDBcbiAgfVxuXG4gIC8qKlxuICAgKiBMaXN0cyByZXN0cmljdC1jaGVjayB0ZW5hbnRzIGZvciBvbmUgY29uZmlndXJlZCB0ZW5hbnQgcHJvdmlkZXIuXG4gICAqIEBwYXJhbSB7UmVzdHJpY3RJbnN0YW5jZVJlbGF0aW9uc2hpcH0gaW5zdGFuY2VSZWxhdGlvbnNoaXAgLSBSZWxhdGlvbnNoaXAgaW5zdGFuY2UgdG8gY291bnQuXG4gICAqIEBwYXJhbSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBUYXJnZXRNb2RlbENsYXNzIC0gUmVsYXRlZCBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGlkZW50aWZpZXIgLSBUZW5hbnQgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtUZW5hbnREYXRhYmFzZVByb3ZpZGVyVHlwZX0gcHJvdmlkZXIgLSBUZW5hbnQgZGF0YWJhc2UgcHJvdmlkZXIuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gTGlzdGVkIHRlbmFudCBvYmplY3RzLlxuICAgKi9cbiAgYXN5bmMgX2RlcGVuZGVudFJlc3RyaWN0UHJvdmlkZXJUZW5hbnRzKGluc3RhbmNlUmVsYXRpb25zaGlwLCBUYXJnZXRNb2RlbENsYXNzLCBpZGVudGlmaWVyLCBwcm92aWRlcikge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5fZ2V0Q29uZmlndXJhdGlvbigpXG4gICAgY29uc3QgbGlzdFRlbmFudHMgPSB0eXBlb2YgcHJvdmlkZXIubGlzdFJlc3RyaWN0VGVuYW50cyA9PSBcImZ1bmN0aW9uXCJcbiAgICAgID8gcHJvdmlkZXIubGlzdFJlc3RyaWN0VGVuYW50c1xuICAgICAgOiBwcm92aWRlci5saXN0VGVuYW50c1xuICAgIGNvbnN0IGxpc3RUZW5hbnRzTWV0aG9kTmFtZSA9IHR5cGVvZiBwcm92aWRlci5saXN0UmVzdHJpY3RUZW5hbnRzID09IFwiZnVuY3Rpb25cIlxuICAgICAgPyBcImxpc3RSZXN0cmljdFRlbmFudHNcIlxuICAgICAgOiBcImxpc3RUZW5hbnRzXCJcblxuICAgIGlmICh0eXBlb2YgbGlzdFRlbmFudHMgIT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFRlbmFudCBkYXRhYmFzZSBwcm92aWRlciBmb3IgJHtpZGVudGlmaWVyfSBtdXN0IGRlZmluZSBsaXN0VGVuYW50cyBvciBsaXN0UmVzdHJpY3RUZW5hbnRzIGJlZm9yZSBkZXBlbmRlbnQgcmVzdHJpY3QgY2FuIGNoZWNrICR7aW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0UmVsYXRpb25zaGlwKCkuZ2V0UmVsYXRpb25zaGlwTmFtZSgpfWApXG4gICAgfVxuXG4gICAgY29uc3QgdGVuYW50cyA9IGF3YWl0IGNvbmZpZ3VyYXRpb24uZW5zdXJlQ29ubmVjdGlvbnMoe25hbWU6IGBEZXBlbmRlbnQgcmVzdHJpY3QgdGVuYW50czogJHtUYXJnZXRNb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpfWB9LCBhc3luYyAoKSA9PiB7XG4gICAgICByZXR1cm4gYXdhaXQgbGlzdFRlbmFudHMoe1xuICAgICAgICBjb25maWd1cmF0aW9uLFxuICAgICAgICBpZGVudGlmaWVyXG4gICAgICB9KVxuICAgIH0pXG5cbiAgICBpZiAoIUFycmF5LmlzQXJyYXkodGVuYW50cykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVGVuYW50IGRhdGFiYXNlIHByb3ZpZGVyIGZvciAke2lkZW50aWZpZXJ9IG11c3QgcmV0dXJuIGFuIGFycmF5IGZyb20gJHtsaXN0VGVuYW50c01ldGhvZE5hbWV9YClcbiAgICB9XG5cbiAgICByZXR1cm4gdGVuYW50c1xuICB9XG5cbiAgLyoqXG4gICAqIERlc3Ryb3lzIHRoZSByZWNvcmQgaW4gdGhlIGRhdGFiYXNlIGFuZCBhbGwgb2YgaXRzIGRlcGVuZGVudCByZWNvcmRzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgZGVzdHJveSgpIHtcbiAgICBhd2FpdCB0aGlzLl9ydW5MaWZlY3ljbGVDYWxsYmFja3MoXCJiZWZvcmVEZXN0cm95XCIpXG5cbiAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcCBvZiB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRSZWxhdGlvbnNoaXBzKCkpIHtcbiAgICAgIGlmIChyZWxhdGlvbnNoaXAuZ2V0RGVwZW5kZW50KCkgPT0gXCJyZXN0cmljdFwiKSB7XG4gICAgICAgIGNvbnN0IGluc3RhbmNlUmVsYXRpb25zaGlwID0gLyoqIEB0eXBlIHtSZXN0cmljdEluc3RhbmNlUmVsYXRpb25zaGlwfSAqLyAodGhpcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwLmdldFJlbGF0aW9uc2hpcE5hbWUoKSkpXG4gICAgICAgIGNvbnN0IGNvdW50ID0gYXdhaXQgdGhpcy5fZGVwZW5kZW50UmVzdHJpY3RDb3VudChpbnN0YW5jZVJlbGF0aW9uc2hpcClcblxuICAgICAgICBpZiAoY291bnQgPiAwKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgZGVsZXRlIHJlY29yZCBiZWNhdXNlIGRlcGVuZGVudCAke3JlbGF0aW9uc2hpcC5nZXRSZWxhdGlvbnNoaXBOYW1lKCl9IGV4aXN0YClcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGlmIChyZWxhdGlvbnNoaXAuZ2V0RGVwZW5kZW50KCkgIT0gXCJkZXN0cm95XCIpIHtcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgaW5zdGFuY2VSZWxhdGlvbnNoaXAgPSB0aGlzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXAuZ2V0UmVsYXRpb25zaGlwTmFtZSgpKVxuXG4gICAgICAvKipcbiAgICAgICAqIERlZmluZXMgbW9kZWxzLlxuICAgICAgICogQHR5cGUge1ZlbG9jaW91c0RhdGFiYXNlUmVjb3JkW119ICovXG4gICAgICBsZXQgbW9kZWxzXG5cbiAgICAgIGlmIChpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRUeXBlKCkgPT0gXCJiZWxvbmdzVG9cIikge1xuICAgICAgICBpZiAoIWluc3RhbmNlUmVsYXRpb25zaGlwLmlzTG9hZGVkKCkpIHtcbiAgICAgICAgICBhd2FpdCBpbnN0YW5jZVJlbGF0aW9uc2hpcC5sb2FkKClcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IG1vZGVsID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAubG9hZGVkKClcblxuICAgICAgICBpZiAobW9kZWwgaW5zdGFuY2VvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZCkge1xuICAgICAgICAgIG1vZGVscyA9IFttb2RlbF1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuZXhwZWN0ZWQgbG9hZGVkIHR5cGU6ICR7dHlwZW9mIG1vZGVsfWApXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAoaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0VHlwZSgpID09IFwiaGFzTWFueVwiKSB7XG4gICAgICAgIGlmICghaW5zdGFuY2VSZWxhdGlvbnNoaXAuaXNMb2FkZWQoKSkge1xuICAgICAgICAgIGF3YWl0IGluc3RhbmNlUmVsYXRpb25zaGlwLmxvYWQoKVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgbG9hZGVkTW9kZWxzID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAubG9hZGVkKClcblxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShsb2FkZWRNb2RlbHMpKSB7XG4gICAgICAgICAgbW9kZWxzID0gbG9hZGVkTW9kZWxzXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmV4cGVjdGVkIGxvYWRlZCB0eXBlOiAke3R5cGVvZiBsb2FkZWRNb2RlbHN9YClcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmIChpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRUeXBlKCkgPT0gXCJoYXNPbmVcIikge1xuICAgICAgICBpZiAoIWluc3RhbmNlUmVsYXRpb25zaGlwLmlzTG9hZGVkKCkpIHtcbiAgICAgICAgICBhd2FpdCBpbnN0YW5jZVJlbGF0aW9uc2hpcC5sb2FkKClcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGxvYWRlZE1vZGVsID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAubG9hZGVkKClcblxuICAgICAgICBpZiAobG9hZGVkTW9kZWwgaW5zdGFuY2VvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZCkge1xuICAgICAgICAgIG1vZGVscyA9IFtsb2FkZWRNb2RlbF1cbiAgICAgICAgfSBlbHNlIGlmIChsb2FkZWRNb2RlbCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgbW9kZWxzID0gW11cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuZXhwZWN0ZWQgbG9hZGVkIHR5cGU6ICR7dHlwZW9mIGxvYWRlZE1vZGVsfWApXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5oYW5kbGVkIHJlbGF0aW9uc2hpcCB0eXBlOiAke2luc3RhbmNlUmVsYXRpb25zaGlwLmdldFR5cGUoKX1gKVxuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IG1vZGVsIG9mIG1vZGVscykge1xuICAgICAgICBpZiAobW9kZWwuaXNQZXJzaXN0ZWQoKSkge1xuICAgICAgICAgIGF3YWl0IG1vZGVsLmRlc3Ryb3koKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQ29uZGl0aW9ucy5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGNvbmRpdGlvbnMgPSB7fVxuXG4gICAgY29uZGl0aW9uc1t0aGlzLmdldE1vZGVsQ2xhc3MoKS5wcmltYXJ5S2V5KCldID0gdGhpcy5pZCgpXG5cbiAgICBjb25zdCBzcWwgPSB0aGlzLl9jb25uZWN0aW9uKCkuZGVsZXRlU3FsKHtcbiAgICAgIGNvbmRpdGlvbnMsXG4gICAgICB0YWJsZU5hbWU6IHRoaXMuX3RhYmxlTmFtZSgpXG4gICAgfSlcblxuICAgIGF3YWl0IHRoaXMuX2Nvbm5lY3Rpb24oKS5xdWVyeShzcWwsIHtsb2dOYW1lOiBgJHt0aGlzLmdldE1vZGVsQ2xhc3MoKS5uYW1lfSBEZXN0cm95YH0pXG4gICAgYXdhaXQgdGhpcy5fcnVuTGlmZWN5Y2xlQ2FsbGJhY2tzKFwiYWZ0ZXJEZXN0cm95XCIpXG4gICAgYXdhaXQgdGhpcy5fZW1pdFJlY29yZENoYW5nZUFmdGVyQ29tbWl0KFwiZGVzdHJveVwiKVxuICB9XG5cbiAgLyoqXG4gICAqIEVtaXRzIGEgY29tbWl0dGVkIHJlY29yZC1jaGFuZ2UgZXZlbnQgYWZ0ZXIgdGhlIHN1cnJvdW5kaW5nIHRyYW5zYWN0aW9uXG4gICAqIGNvbW1pdHMsIHNvIGxpdmUgcXVlcmllcyByZS1ydW4gdW5pZm9ybWx5IGZvciBsb2NhbCB3cml0ZXMsIHB1bGwgYXBwbGllcywgYW5kXG4gICAqIHJlYWx0aW1lIGFwcGxpZXMgKHdoaWNoIGFsbCBlbmQgYXMgbG9jYWwgc2F2ZXMvZGVzdHJveXMpLiBSZWdpc3RlcmVkIHRocm91Z2hcbiAgICogdGhlIGNvbm5lY3Rpb24ncyBhZnRlckNvbW1pdCBob29rIHNvIGEgcm9sbGVkLWJhY2sgc2F2ZSBlbWl0cyBub3RoaW5nLCBhbmRcbiAgICogc2tpcHBlZCBlbnRpcmVseSB3aGVuIG5vdGhpbmcgb2JzZXJ2ZXMgdGhpcyBtb2RlbCBjbGFzcyBzbyBzZXJ2ZXItc2lkZSBzYXZlc1xuICAgKiBzdGF5IGZyZWUgb2YgbGl2ZS1xdWVyeSBvdmVyaGVhZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9yZWNvcmQtY2hhbmdlcy5qc1wiKS5SZWNvcmRDaGFuZ2VPcGVyYXRpb259IG9wZXJhdGlvbiAtIFRoZSBjb21taXR0ZWQgb3BlcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIF9lbWl0UmVjb3JkQ2hhbmdlQWZ0ZXJDb21taXQob3BlcmF0aW9uKSB7XG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpXG5cbiAgICBpZiAoIXJlY29yZENoYW5nZXMuaGFzTGlzdGVuZXJzKG1vZGVsQ2xhc3MpKSByZXR1cm5cblxuICAgIGNvbnN0IHJlY29yZCA9IHRoaXNcbiAgICBjb25zdCBkYXRhYmFzZUlkZW50aXR5ID0gdGhpcy5fZGF0YWJhc2VPcGVyYXRpb25cbiAgICAgID8gdGhpcy5fZGF0YWJhc2VPcGVyYXRpb24uZGF0YWJhc2VJZGVudGl0eSgpXG4gICAgICA6IHRoaXMuX2RhdGFiYXNlSWRlbnRpdHlGb3JDb25uZWN0aW9uKHRoaXMuX2Nvbm5lY3Rpb24oKSlcblxuICAgIHRoaXMuY2FwdHVyZURhdGFiYXNlSWRlbnRpdHkoZGF0YWJhc2VJZGVudGl0eSlcblxuICAgIGF3YWl0IHRoaXMuX2Nvbm5lY3Rpb24oKS5hZnRlckNvbW1pdCgoKSA9PiB7XG4gICAgICByZWNvcmRDaGFuZ2VzLmVtaXQoe2RhdGFiYXNlSWRlbnRpdHksIG1vZGVsQ2xhc3MsIG9wZXJhdGlvbiwgcmVjb3JkfSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFN0b3JlcyBhbiBhdWRpdCByb3cgZm9yIHRoaXMgcmVjb3JkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vYXVkaXRpbmcuanNcIikuQ3JlYXRlQXVkaXRBcmdzfSBhcmdzIC0gQXVkaXQgcm93IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlciB8IHN0cmluZz59IENyZWF0ZWQgYXVkaXQgcm93IGlkLlxuICAgKi9cbiAgYXN5bmMgY3JlYXRlQXVkaXQoYXJncykge1xuICAgIHJldHVybiBhd2FpdCBjcmVhdGVBdWRpdCh0aGlzLCBhcmdzKVxuICB9XG5cbiAgLyoqXG4gICAqIENhcHR1cmVzIGNyZWF0ZSBjaGFuZ2VzIGJlZm9yZSBwZXJzaXN0ZW5jZSBjbGVhcnMgdGhlIGNoYW5nZSBzZXQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgY2FwdHVyZUNyZWF0ZUF1ZGl0Q2hhbmdlcygpIHtcbiAgICBjYXB0dXJlQ3JlYXRlQXVkaXRDaGFuZ2VzKHRoaXMpXG4gIH1cblxuICAvKipcbiAgICogV3JpdGVzIHRoZSBjcmVhdGUgYXVkaXQgcm93LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIGNyZWF0ZUNyZWF0ZUF1ZGl0KCkge1xuICAgIGF3YWl0IGNyZWF0ZUNyZWF0ZUF1ZGl0KHRoaXMpXG4gIH1cblxuICAvKipcbiAgICogQ2FwdHVyZXMgdXBkYXRlIGNoYW5nZXMgYmVmb3JlIHBlcnNpc3RlbmNlIGNsZWFycyB0aGUgY2hhbmdlIHNldC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBjYXB0dXJlVXBkYXRlQXVkaXRDaGFuZ2VzKCkge1xuICAgIGNhcHR1cmVVcGRhdGVBdWRpdENoYW5nZXModGhpcylcbiAgfVxuXG4gIC8qKlxuICAgKiBXcml0ZXMgdGhlIHVwZGF0ZSBhdWRpdCByb3cuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgY3JlYXRlVXBkYXRlQXVkaXQoKSB7XG4gICAgYXdhaXQgY3JlYXRlVXBkYXRlQXVkaXQodGhpcylcbiAgfVxuXG4gIC8qKlxuICAgKiBXcml0ZXMgdGhlIGRlc3Ryb3kgYXVkaXQgcm93LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAgICovXG4gIGFzeW5jIGNyZWF0ZURlc3Ryb3lBdWRpdCgpIHtcbiAgICBhd2FpdCBjcmVhdGVEZXN0cm95QXVkaXQodGhpcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJ1biBsaWZlY3ljbGUgY2FsbGJhY2tzLlxuICAgKiBAcGFyYW0ge1wiYWZ0ZXJDcmVhdGVcIiB8IFwiYWZ0ZXJEZXN0cm95XCIgfCBcImFmdGVyU2F2ZVwiIHwgXCJhZnRlclVwZGF0ZVwiIHwgXCJiZWZvcmVDcmVhdGVcIiB8IFwiYmVmb3JlRGVzdHJveVwiIHwgXCJiZWZvcmVTYXZlXCIgfCBcImJlZm9yZVVwZGF0ZVwiIHwgXCJiZWZvcmVWYWxpZGF0aW9uXCJ9IGNhbGxiYWNrTmFtZSAtIENhbGxiYWNrIHR5cGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX3J1bkxpZmVjeWNsZUNhbGxiYWNrcyhjYWxsYmFja05hbWUpIHtcbiAgICBjb25zdCBjYWxsYmFja3MgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRMaWZlY3ljbGVDYWxsYmFja3NNYXAoKVtjYWxsYmFja05hbWVdIHx8IFtdXG4gICAgbGV0IGNhbGxiYWNrTmFtZVJlZ2lzdGVyZWRBc1N0cmluZyA9IGZhbHNlXG5cbiAgICBmb3IgKGNvbnN0IGNhbGxiYWNrIG9mIGNhbGxiYWNrcykge1xuICAgICAgaWYgKHR5cGVvZiBjYWxsYmFjayA9PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIGlmIChjYWxsYmFjayA9PSBjYWxsYmFja05hbWUpIHtcbiAgICAgICAgICBjYWxsYmFja05hbWVSZWdpc3RlcmVkQXNTdHJpbmcgPSB0cnVlXG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgZHluYW1pY1RoaXMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSlcbiAgICAgICAgY29uc3QgbWV0aG9kQ2FsbGJhY2sgPSBkeW5hbWljVGhpc1tjYWxsYmFja11cblxuICAgICAgICBpZiAodHlwZW9mIG1ldGhvZENhbGxiYWNrICE9IFwiZnVuY3Rpb25cIikge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTGlmZWN5Y2xlIGNhbGxiYWNrIFwiJHtjYWxsYmFja31cIiBpcyBub3QgYSBmdW5jdGlvbiBvbiAke3RoaXMuZ2V0TW9kZWxDbGFzcygpLm5hbWV9YClcbiAgICAgICAgfVxuXG4gICAgICAgIGF3YWl0IG1ldGhvZENhbGxiYWNrLmNhbGwodGhpcylcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGF3YWl0IGNhbGxiYWNrKHRoaXMpXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgZHluYW1pY1RoaXMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSlcbiAgICBjb25zdCBpbnN0YW5jZUNhbGxiYWNrID0gZHluYW1pY1RoaXNbY2FsbGJhY2tOYW1lXVxuXG4gICAgaWYgKCFjYWxsYmFja05hbWVSZWdpc3RlcmVkQXNTdHJpbmcgJiYgdHlwZW9mIGluc3RhbmNlQ2FsbGJhY2sgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgYXdhaXQgaW5zdGFuY2VDYWxsYmFjay5jYWxsKHRoaXMpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaGFzIGNoYW5nZXMuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgY2hhbmdlcy5cbiAgICovXG4gIF9oYXNDaGFuZ2VzKCkgeyByZXR1cm4gT2JqZWN0LmtleXModGhpcy5fY2hhbmdlcykubGVuZ3RoID4gMCB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdHJ1ZSBpZiB0aGUgbW9kZWwgaGFzIGJlZW4gY2hhbmdlZCBzaW5jZSBpdCB3YXMgbG9hZGVkIGZyb20gdGhlIGRhdGFiYXNlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGNoYW5nZWQuXG4gICAqL1xuICBpc0NoYW5nZWQoKSB7XG4gICAgaWYgKHRoaXMuaXNOZXdSZWNvcmQoKSB8fCB0aGlzLl9oYXNDaGFuZ2VzKCkpe1xuICAgICAgcmV0dXJuIHRydWVcbiAgICB9XG5cbiAgICAvLyBDaGVjayBpZiBhIGxvYWRlZCBzdWItbW9kZWwgb2YgYSByZWxhdGlvbnNoaXAgaXMgY2hhbmdlZCBhbmQgc2hvdWxkIGJlIHNhdmVkIGFsb25nIHdpdGggdGhpcyBtb2RlbC5cbiAgICBpZiAodGhpcy5faW5zdGFuY2VSZWxhdGlvbnNoaXBzKSB7XG4gICAgICBmb3IgKGNvbnN0IGluc3RhbmNlUmVsYXRpb25zaGlwTmFtZSBpbiB0aGlzLl9pbnN0YW5jZVJlbGF0aW9uc2hpcHMpIHtcbiAgICAgICAgY29uc3QgaW5zdGFuY2VSZWxhdGlvbnNoaXAgPSB0aGlzLl9pbnN0YW5jZVJlbGF0aW9uc2hpcHNbaW5zdGFuY2VSZWxhdGlvbnNoaXBOYW1lXVxuICAgICAgICBsZXQgbG9hZGVkID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAuX2xvYWRlZFxuXG4gICAgICAgIGlmIChpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRBdXRvU2F2ZSgpID09PSBmYWxzZSkge1xuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIWxvYWRlZCkgY29udGludWVcbiAgICAgICAgaWYgKCFBcnJheS5pc0FycmF5KGxvYWRlZCkpIGxvYWRlZCA9IFtsb2FkZWRdXG5cbiAgICAgICAgZm9yIChjb25zdCBtb2RlbCBvZiBsb2FkZWQpIHtcbiAgICAgICAgICBpZiAobW9kZWwuaXNDaGFuZ2VkKCkpIHtcbiAgICAgICAgICAgIHJldHVybiB0cnVlXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgY2hhbmdlcyB0aGF0IGhhdmUgYmVlbiBtYWRlIHRvIHRoaXMgcmVjb3JkIHNpbmNlIGl0IHdhcyBsb2FkZWQgZnJvbSB0aGUgZGF0YWJhc2UuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAtIFRoZSBjaGFuZ2VzLlxuICAgKi9cbiAgY2hhbmdlcygpIHtcbiAgICAvKipcbiAgICAgKiBDaGFuZ2VzLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4+fSAqL1xuICAgIGNvbnN0IGNoYW5nZXMgPSB7fVxuXG4gICAgZm9yIChjb25zdCBjaGFuZ2VLZXkgaW4gdGhpcy5fY2hhbmdlcykge1xuICAgICAgY29uc3QgY2hhbmdlVmFsdWUgPSB0aGlzLl9jaGFuZ2VzW2NoYW5nZUtleV1cblxuICAgICAgY2hhbmdlc1tjaGFuZ2VLZXldID0gW3RoaXMuX2F0dHJpYnV0ZXNbY2hhbmdlS2V5XSwgY2hhbmdlVmFsdWVdXG4gICAgfVxuXG4gICAgcmV0dXJuIGNoYW5nZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRhYmxlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHRhYmxlIG5hbWUuXG4gICAqL1xuICBfdGFibGVOYW1lKCkge1xuICAgIGlmICh0aGlzLl9fdGFibGVOYW1lKSByZXR1cm4gdGhpcy5fX3RhYmxlTmFtZVxuXG4gICAgcmV0dXJuIHRoaXMuZ2V0TW9kZWxDbGFzcygpLnRhYmxlTmFtZSgpXG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgYW4gYXR0cmlidXRlIHZhbHVlIGZyb20gdGhlIHJlY29yZC4gUmVhZCBkeW5hbWljYWxseSBieSBuYW1lLCBzbyB0aGUgdmFsdWUgY2FuIGJlIGFueVxuICAgKiBjb2x1bW4gdHlwZSBhbmQgbWF5IGJlIG92ZXJyaWRkZW4gYnkgYSB1c2VyLWRlZmluZWQgZ2V0dGVyIG9uIHRoZSBtb2RlbC5cbiAgICogQHRlbXBsYXRlIFZcbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgVGhlIG5hbWUgb2YgdGhlIGF0dHJpYnV0ZSB0byByZWFkLiBUaGlzIGlzIHRoZSBhdHRyaWJ1dGUgbmFtZSwgbm90IHRoZSBjb2x1bW4gbmFtZS5cbiAgICogQHJldHVybnMge1Z9IFRoZSBhdHRyaWJ1dGUgdmFsdWUsIHR5cGVkIGJ5IHRoZSBjYWxsZXIncyBhY2Nlc3NvciBjb250cmFjdC5cbiAgICovXG4gIHJlYWRBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSkge1xuICAgIHRoaXMuZ2V0TW9kZWxDbGFzcygpLl9hc3NlcnRIYXNCZWVuSW5pdGlhbGl6ZWQoKVxuICAgIGNvbnN0IG1hcCA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldEF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXAoKVxuICAgIGNvbnN0IHJlc29sdmVkQXR0cmlidXRlTmFtZSA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLnJlc29sdmVBdHRyaWJ1dGVOYW1lKGF0dHJpYnV0ZU5hbWUpXG4gICAgY29uc3QgY29sdW1uTmFtZSA9IHJlc29sdmVkQXR0cmlidXRlTmFtZSA/IG1hcFtyZXNvbHZlZEF0dHJpYnV0ZU5hbWVdIDogdW5kZWZpbmVkXG5cbiAgICBpZiAoIWNvbHVtbk5hbWUpIHRocm93IG5ldyBFcnJvcihgQ291bGRuJ3QgZmlndXJlIG91dCBjb2x1bW4gbmFtZSBmb3IgYXR0cmlidXRlOiAke2F0dHJpYnV0ZU5hbWV9IGZyb20gdGhlc2UgbWFwcGluZ3M6ICR7T2JqZWN0LmtleXMobWFwKS5qb2luKFwiLCBcIil9YClcblxuICAgIHJldHVybiAvKiogQHR5cGUge1Z9ICovICh0aGlzLnJlYWRDb2x1bW4oY29sdW1uTmFtZSkpXG4gIH1cblxuICAvKipcbiAgICogUmVhZCBhbiBhc3NvY2lhdGlvbiBjb3VudCBhdHRhY2hlZCBieSBgLndpdGhDb3VudCguLi4pYC4gQ291bnRzIGFyZVxuICAgKiBzdG9yZWQgb24gYSBzZXBhcmF0ZSBtYXAgZnJvbSB0aGUgcmVjb3JkJ3MgYF9hdHRyaWJ1dGVzYCBzbyBhXG4gICAqIHZpcnR1YWwgY291bnQgbGlrZSBgdGFza3NDb3VudGAgY2Fubm90IHNpbGVudGx5IHNoYWRvdyBhIHJlYWxcbiAgICogY29sdW1uIG9mIHRoZSBzYW1lIG5hbWUuIFJldHVybnMgdGhlIGF0dGFjaGVkIG51bWJlciwgb3IgMCB3aGVuXG4gICAqIGAud2l0aENvdW50KC4uLilgIHdhc24ndCByZXF1ZXN0ZWQgZm9yIHRoaXMgYXR0cmlidXRlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lLCBlLmcuIGBcInRhc2tzQ291bnRcImAgb3IgYSBjdXN0b20gYFwiYWN0aXZlTWVtYmVyc0NvdW50XCJgIGZyb20gYC53aXRoQ291bnQoe2FjdGl2ZU1lbWJlcnNDb3VudDogey4uLn19KWAuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ9IC0gQXR0YWNoZWQgYXNzb2NpYXRpb24gY291bnQsIG9yIHplcm8gd2hlbiBhYnNlbnQuXG4gICAqL1xuICByZWFkQ291bnQoYXR0cmlidXRlTmFtZSkge1xuICAgIHJldHVybiByZWFkUGF5bG9hZEFzc29jaWF0aW9uQ291bnQoLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9yZWNvcmQtcGF5bG9hZC12YWx1ZXMuanNcIikuUmVjb3JkUGF5bG9hZFZhbHVlc1RhcmdldH0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSksIGF0dHJpYnV0ZU5hbWUpXG4gIH1cblxuICAvKipcbiAgICogQXR0YWNoIGFuIGFzc29jaWF0aW9uIGNvdW50IHRvIHRoaXMgcmVjb3JkLiBJbnRlcm5hbCBoZWxwZXIgdXNlZCBieVxuICAgKiB0aGUgYHdpdGhDb3VudGAgcnVubmVyOyBvdXRzaWRlIGNvZGUgc2hvdWxkIG5vdCBjYWxsIHRoaXMgZGlyZWN0bHkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSB2YWx1ZSAtIENvdW50IHZhbHVlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zZXRBc3NvY2lhdGlvbkNvdW50KGF0dHJpYnV0ZU5hbWUsIHZhbHVlKSB7XG4gICAgc2V0UGF5bG9hZEFzc29jaWF0aW9uQ291bnQoLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9yZWNvcmQtcGF5bG9hZC12YWx1ZXMuanNcIikuUmVjb3JkUGF5bG9hZFZhbHVlc1RhcmdldH0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSksIGF0dHJpYnV0ZU5hbWUsIHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIEFsbCBhdHRhY2hlZCBhc3NvY2lhdGlvbiBjb3VudHMgYXMgYSBwbGFpbiBvYmplY3QuIFVzZWQgYnkgdGhlXG4gICAqIGZyb250ZW5kLW1vZGVsIHNlcmlhbGl6ZXIgdG8gc2hpcCBjb3VudHMgYWxvbmdzaWRlIHRoZSByZWNvcmRcbiAgICogYXR0cmlidXRlcyBvbiB0aGUgd2lyZS5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIG51bWJlcj59IC0gQXNzb2NpYXRpb24gY291bnRzIGtleWVkIGJ5IGF0dHJpYnV0ZSBuYW1lLlxuICAgKi9cbiAgYXNzb2NpYXRpb25Db3VudHMoKSB7XG4gICAgLyoqXG4gICAgICogUmVzdWx0LlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBudW1iZXI+fSAqL1xuICAgIGNvbnN0IHJlc3VsdCA9IHt9XG5cbiAgICBjb25zdCB0YXJnZXQgPSAvKiogQHR5cGUge2ltcG9ydChcIi4uLy4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiKS5SZWNvcmRQYXlsb2FkVmFsdWVzVGFyZ2V0fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKVxuXG4gICAgaWYgKCF0YXJnZXQuX2Fzc29jaWF0aW9uQ291bnRzKSByZXR1cm4gcmVzdWx0XG5cbiAgICBmb3IgKGNvbnN0IFthdHRyaWJ1dGVOYW1lLCB2YWx1ZV0gb2YgdGFyZ2V0Ll9hc3NvY2lhdGlvbkNvdW50cykge1xuICAgICAgcmVzdWx0W2F0dHJpYnV0ZU5hbWVdID0gdmFsdWVcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cblxuICAvKipcbiAgICogUmVhZCBhIHZhbHVlIGF0dGFjaGVkIGJ5IGAucXVlcnlEYXRhKC4uLilgLiBTdG9yZWQgb24gYSBkZWRpY2F0ZWRcbiAgICogbWFwIHJhdGhlciB0aGFuIG9uIGBfYXR0cmlidXRlc2AsIHNvIGEgdmlydHVhbCBxdWVyeURhdGEga2V5IGxpa2VcbiAgICogYHRyYW5zcG9ydFNlY29uZHNTdW1gIGNhbm5vdCBzaWxlbnRseSBzaGFkb3cgYSByZWFsIGNvbHVtbiBvZiB0aGVcbiAgICogc2FtZSBuYW1lLiBSZXR1cm5zIGBudWxsYCB3aGVuIHRoZSBrZXkgd2Fzbid0IHByb2R1Y2VkIGJ5IGFueVxuICAgKiByZWdpc3RlcmVkIGZuIGZvciB0aGlzIHJlY29yZCAoZS5nLiBubyBjaGlsZCByb3dzIG1hdGNoZWQgdGhlXG4gICAqIGFnZ3JlZ2F0ZSkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gcXVlcnlEYXRhIGF0dHJpYnV0ZSBuYW1lIChtYXRjaGVzIGEgU0VMRUNUIGFsaWFzIGZyb20gdGhlIHJlZ2lzdGVyZWQgZm4pLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gQXR0YWNoZWQgcXVlcnktZGF0YSB2YWx1ZS5cbiAgICovXG4gIHF1ZXJ5RGF0YShuYW1lKSB7XG4gICAgcmV0dXJuIHJlYWRQYXlsb2FkUXVlcnlEYXRhKC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vLi4vcmVjb3JkLXBheWxvYWQtdmFsdWVzLmpzXCIpLlJlY29yZFBheWxvYWRWYWx1ZXNUYXJnZXR9ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpLCBuYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIEF0dGFjaCBhIHF1ZXJ5RGF0YSB2YWx1ZSB0byB0aGlzIHJlY29yZC4gSW50ZXJuYWwgaGVscGVyIHVzZWQgYnlcbiAgICogdGhlIGBxdWVyeURhdGFgIHJ1bm5lciBhbmQgYnkgZnJvbnRlbmQtbW9kZWwgaHlkcmF0aW9uOyBvdXRzaWRlXG4gICAqIGNvZGUgc2hvdWxkIG5vdCBjYWxsIHRoaXMgZGlyZWN0bHkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gcXVlcnlEYXRhIGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFZhbHVlIHRvIGF0dGFjaC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBfc2V0UXVlcnlEYXRhKG5hbWUsIHZhbHVlKSB7XG4gICAgc2V0UGF5bG9hZFF1ZXJ5RGF0YSgvKiogQHR5cGUge2ltcG9ydChcIi4uLy4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiKS5SZWNvcmRQYXlsb2FkVmFsdWVzVGFyZ2V0fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKSwgbmFtZSwgdmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogQWxsIGF0dGFjaGVkIHF1ZXJ5RGF0YSB2YWx1ZXMgYXMgYSBwbGFpbiBvYmplY3QuIFVzZWQgYnkgdGhlXG4gICAqIGZyb250ZW5kLW1vZGVsIHNlcmlhbGl6ZXIgdG8gc2hpcCBxdWVyeURhdGEgYWxvbmdzaWRlIHRoZSByZWNvcmRcbiAgICogYXR0cmlidXRlcyBvbiB0aGUgd2lyZS5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBRdWVyeS1kYXRhIHZhbHVlcyBrZXllZCBieSBuYW1lLlxuICAgKi9cbiAgcXVlcnlEYXRhVmFsdWVzKCkge1xuICAgIC8qKlxuICAgICAqIFJlc3VsdC5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IHJlc3VsdCA9IHt9XG5cbiAgICBjb25zdCB0YXJnZXQgPSAvKiogQHR5cGUge2ltcG9ydChcIi4uLy4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiKS5SZWNvcmRQYXlsb2FkVmFsdWVzVGFyZ2V0fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKVxuXG4gICAgaWYgKCF0YXJnZXQuX3F1ZXJ5RGF0YVZhbHVlcykgcmV0dXJuIHJlc3VsdFxuXG4gICAgZm9yIChjb25zdCBbbmFtZSwgdmFsdWVdIG9mIHRhcmdldC5fcXVlcnlEYXRhVmFsdWVzKSB7XG4gICAgICByZXN1bHRbbmFtZV0gPSB2YWx1ZVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkIGEgcGVyLXJlY29yZCBhYmlsaXR5IHJlc3VsdCBhdHRhY2hlZCBieSBgLmFiaWxpdGllcyguLi4pYC4gVGhlXG4gICAqIGJhY2tlbmQgZXZhbHVhdGVzIGVhY2ggcmVxdWVzdGVkIGFjdGlvbiBhZ2FpbnN0IHRoZSBjdXJyZW50IGFiaWxpdHlcbiAgICogZm9yIHRoaXMgcmVjb3JkIGluc3RhbmNlIGFuZCBzaGlwcyB0aGUgcmVzdWx0IGFsb25nc2lkZSB0aGVcbiAgICogcmVjb3JkJ3MgYXR0cmlidXRlcy4gUmV0dXJucyBgZmFsc2VgIHdoZW4gdGhlIGFjdGlvbiB3YXNuJ3RcbiAgICogcmVxdWVzdGVkIGZvciB0aGlzIHJlY29yZCDigJQgc28gVUkgY29kZSBjYW4gc2FmZWx5IGJyYW5jaCBvblxuICAgKiBgcmVjb3JkLmNhbihcInVwZGF0ZVwiKWAgd2l0aG91dCBmaXJzdCBjaGVja2luZyB3aGV0aGVyIHRoZSBhYmlsaXR5XG4gICAqIHdhcyBsb2FkZWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhY3Rpb24gLSBBYmlsaXR5IGFjdGlvbiBuYW1lLCBlLmcuIGBcInVwZGF0ZVwiYC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgcmVxdWVzdGVkIGFiaWxpdHkgaXMgYWxsb3dlZC5cbiAgICovXG4gIGNhbihhY3Rpb24pIHtcbiAgICByZXR1cm4gcmVhZFBheWxvYWRDb21wdXRlZEFiaWxpdHkoLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9yZWNvcmQtcGF5bG9hZC12YWx1ZXMuanNcIikuUmVjb3JkUGF5bG9hZFZhbHVlc1RhcmdldH0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSksIGFjdGlvbilcbiAgfVxuXG4gIC8qKlxuICAgKiBBdHRhY2ggYSBwZXItcmVjb3JkIGFiaWxpdHkgcmVzdWx0IHRvIHRoaXMgcmVjb3JkLiBJbnRlcm5hbCBoZWxwZXJcbiAgICogdXNlZCBieSB0aGUgYGFiaWxpdGllc2AgcnVubmVyIGFuZCBieSBmcm9udGVuZC1tb2RlbCBoeWRyYXRpb247XG4gICAqIG91dHNpZGUgY29kZSBzaG91bGQgbm90IGNhbGwgdGhpcyBkaXJlY3RseS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFjdGlvbiAtIEFiaWxpdHkgYWN0aW9uIG5hbWUuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gdmFsdWUgLSBXaGV0aGVyIHRoZSBjdXJyZW50IGFiaWxpdHkgcGVybWl0cyB0aGUgYWN0aW9uIG9uIHRoaXMgcmVjb3JkLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zZXRDb21wdXRlZEFiaWxpdHkoYWN0aW9uLCB2YWx1ZSkge1xuICAgIHNldFBheWxvYWRDb21wdXRlZEFiaWxpdHkoLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9yZWNvcmQtcGF5bG9hZC12YWx1ZXMuanNcIikuUmVjb3JkUGF5bG9hZFZhbHVlc1RhcmdldH0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSksIGFjdGlvbiwgdmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogQWxsIGF0dGFjaGVkIHBlci1yZWNvcmQgYWJpbGl0eSByZXN1bHRzIGFzIGEgcGxhaW4gb2JqZWN0LiBVc2VkXG4gICAqIGJ5IHRoZSBmcm9udGVuZC1tb2RlbCBzZXJpYWxpemVyIHRvIHNoaXAgcmVzdWx0cyBhbG9uZ3NpZGUgdGhlXG4gICAqIHJlY29yZCBhdHRyaWJ1dGVzIG9uIHRoZSB3aXJlLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgYm9vbGVhbj59IC0gQWJpbGl0eSByZXN1bHRzIGtleWVkIGJ5IGFjdGlvbi5cbiAgICovXG4gIGNvbXB1dGVkQWJpbGl0aWVzKCkge1xuICAgIC8qKlxuICAgICAqIFJlc3VsdC5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgYm9vbGVhbj59ICovXG4gICAgY29uc3QgcmVzdWx0ID0ge31cblxuICAgIGNvbnN0IHRhcmdldCA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vLi4vcmVjb3JkLXBheWxvYWQtdmFsdWVzLmpzXCIpLlJlY29yZFBheWxvYWRWYWx1ZXNUYXJnZXR9ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpXG5cbiAgICBpZiAoIXRhcmdldC5fY29tcHV0ZWRBYmlsaXRpZXMpIHJldHVybiByZXN1bHRcblxuICAgIGZvciAoY29uc3QgW2FjdGlvbiwgdmFsdWVdIG9mIHRhcmdldC5fY29tcHV0ZWRBYmlsaXRpZXMpIHtcbiAgICAgIHJlc3VsdFthY3Rpb25dID0gdmFsdWVcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cblxuICAvKipcbiAgICogUmVhZHMgYSBjb2x1bW4gdmFsdWUgZnJvbSB0aGUgcmVjb3JkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSBUaGUgbmFtZSBvZiB0aGUgY29sdW1uIHRvIHJlYWQuIFRoaXMgaXMgdGhlIGNvbHVtbiBuYW1lLCBub3QgdGhlIGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gVGhlIGNvbHVtbi5cbiAgICovXG4gIHJlYWRDb2x1bW4oYXR0cmlidXRlTmFtZSkge1xuICAgIHRoaXMuZ2V0TW9kZWxDbGFzcygpLl9hc3NlcnRIYXNCZWVuSW5pdGlhbGl6ZWQoKVxuICAgIGNvbnN0IGJlbG9uZ3NUb0NoYW5nZXMgPSB0aGlzLl9iZWxvbmdzVG9DaGFuZ2VzKClcbiAgICBsZXQgcmVzdWx0XG5cbiAgICBpZiAoYXR0cmlidXRlTmFtZSBpbiBiZWxvbmdzVG9DaGFuZ2VzKSB7XG4gICAgICByZXN1bHQgPSBiZWxvbmdzVG9DaGFuZ2VzW2F0dHJpYnV0ZU5hbWVdXG4gICAgfSBlbHNlIGlmIChhdHRyaWJ1dGVOYW1lIGluIHRoaXMuX2NoYW5nZXMpIHtcbiAgICAgIHJlc3VsdCA9IHRoaXMuX2NoYW5nZXNbYXR0cmlidXRlTmFtZV1cbiAgICB9IGVsc2UgaWYgKGF0dHJpYnV0ZU5hbWUgaW4gdGhpcy5fYXR0cmlidXRlcykge1xuICAgICAgcmVzdWx0ID0gdGhpcy5fYXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXVxuICAgIH0gZWxzZSBpZiAodGhpcy5pc1BlcnNpc3RlZCgpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHN1Y2ggYXR0cmlidXRlIG9yIG5vdCBzZWxlY3RlZCAke3RoaXMuY29uc3RydWN0b3IubmFtZX0jJHthdHRyaWJ1dGVOYW1lfWApXG4gICAgfVxuXG4gICAgY29uc3QgY29sdW1uVHlwZSA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldENvbHVtblR5cGVCeU5hbWUoYXR0cmlidXRlTmFtZSlcblxuICAgIGlmIChjb2x1bW5UeXBlICYmIHRoaXMuZ2V0TW9kZWxDbGFzcygpLl9pc0RhdGVMaWtlVHlwZShjb2x1bW5UeXBlKSkge1xuICAgICAgcmVzdWx0ID0gdGhpcy5fbm9ybWFsaXplRGF0ZVZhbHVlRm9yUmVhZChyZXN1bHQpXG4gICAgfVxuXG4gICAgcmVzdWx0ID0gdGhpcy5fbm9ybWFsaXplQm9vbGVhblZhbHVlRm9yUmVhZCh7Y29sdW1uTmFtZTogYXR0cmlidXRlTmFtZSwgY29sdW1uVHlwZSwgdmFsdWU6IHJlc3VsdH0pXG5cbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYW55IGRlY2xhcmVkIHBlci1hdHRyaWJ1dGUgY2FzdCBmb3IgYSBkYXRhYmFzZSBjb2x1bW4gbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbHVtbk5hbWUgLSBEYXRhYmFzZSBjb2x1bW4gbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBEZWNsYXJlZCBjYXN0IHR5cGUsIG9yIHVuZGVmaW5lZCB3aGVuIG5vbmUgaXMgZGVjbGFyZWQuXG4gICAqL1xuICBfZGVjbGFyZWRBdHRyaWJ1dGVDYXN0Rm9yQ29sdW1uKGNvbHVtbk5hbWUpIHtcbiAgICBjb25zdCBhdHRyaWJ1dGVOYW1lID0gdGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCgpW2NvbHVtbk5hbWVdXG5cbiAgICBpZiAoIWF0dHJpYnV0ZU5hbWUpIHJldHVybiB1bmRlZmluZWRcblxuICAgIHJldHVybiB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRBdHRyaWJ1dGVDYXN0KGF0dHJpYnV0ZU5hbWUpXG4gIH1cblxuICAvKipcbiAgICogQ29udmVydHMgYSBzdG9yZWQgdmFsdWUgdG8gYSByZWFsIGJvb2xlYW4gZm9yIGEgZGVjbGFyZWQgYFwiYm9vbGVhblwiYCBjYXN0LlxuICAgKiBMZWF2ZXMgbnVsbC91bmRlZmluZWQgdW50b3VjaGVkOyB0cmVhdHMgMS90cnVlL1wiMVwiIGFzIHRydWUgYW5kIDAvZmFsc2UvXCIwXCIgYXMgZmFsc2UuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gU3RvcmVkIGRhdGFiYXNlIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gQ29udmVydGVkIGJvb2xlYW4sIG9yIHRoZSBvcmlnaW5hbCB2YWx1ZSB3aGVuIG5vdCByZWNvZ25pemVkLlxuICAgKi9cbiAgX2Nhc3REZWNsYXJlZEJvb2xlYW5Gb3JSZWFkKHZhbHVlKSB7XG4gICAgaWYgKHZhbHVlID09PSBudWxsIHx8IHZhbHVlID09PSB1bmRlZmluZWQpIHJldHVybiB2YWx1ZVxuICAgIGlmIChkZWNsYXJlZEJvb2xlYW5UcnV0aHlWYWx1ZXMuaGFzKHZhbHVlKSkgcmV0dXJuIHRydWVcbiAgICBpZiAoZGVjbGFyZWRCb29sZWFuRmFsc3lWYWx1ZXMuaGFzKHZhbHVlKSkgcmV0dXJuIGZhbHNlXG5cbiAgICByZXR1cm4gdmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIGEgY29sdW1uIHZhbHVlIGlzIGN1cnJlbnRseSBsb2FkZWQgb24gdGhpcyByZWNvcmQgKGVpdGhlciBhcyBhXG4gICAqIHBlcnNpc3RlZCBhdHRyaWJ1dGUgb3IgYSBwZW5kaW5nIGNoYW5nZSkuIFVzZWQgdG8gZGVjaWRlIHdoZXRoZXIgYSBwcmVsb2FkXG4gICAqIGNhbiBiZSBza2lwcGVkIGJlY2F1c2UgdGhlIHJlcXVpcmVkIGNvbHVtbnMgYXJlIGFscmVhZHkgcHJlc2VudC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbHVtbk5hbWUgLSBUaGUgY29sdW1uIG5hbWUgdG8gY2hlY2suXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGNvbHVtbiBpcyBsb2FkZWQuXG4gICAqL1xuICBoYXNMb2FkZWRDb2x1bW4oY29sdW1uTmFtZSkge1xuICAgIHJldHVybiBjb2x1bW5OYW1lIGluIHRoaXMuX2NoYW5nZXMgfHwgY29sdW1uTmFtZSBpbiB0aGlzLl9hdHRyaWJ1dGVzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgYm9vbGVhbiB2YWx1ZSBmb3IgcmVhZC4gQSBkZWNsYXJlZCBgXCJib29sZWFuXCJgIGF0dHJpYnV0ZSBjYXN0IGNvbnZlcnRzIHRoZVxuICAgKiBzdG9yZWQgdmFsdWUgKGUuZy4gYW4gTVNTUUwgYGJpdGAgMC8xKSB0byBhIHJlYWwgYm9vbGVhbjsgb3RoZXJ3aXNlIHRoZSBleGlzdGluZ1xuICAgKiBpbnRyb3NwZWN0ZWQtdHlwZSBub3JtYWxpemF0aW9uIGFwcGxpZXMgKG5vIGJlaGF2aW91ciBjaGFuZ2UgZm9yIG5vbi1kZWNsYXJlZCBjb2x1bW5zKS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY29sdW1uTmFtZSAtIERhdGFiYXNlIGNvbHVtbiBuYW1lIGJlaW5nIHJlYWQuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBhcmdzLmNvbHVtblR5cGUgLSBDb2x1bW4gdHlwZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy52YWx1ZSAtIFZhbHVlIHRvIG5vcm1hbGl6ZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIE5vcm1hbGl6ZWQgdmFsdWUuXG4gICAqL1xuICBfbm9ybWFsaXplQm9vbGVhblZhbHVlRm9yUmVhZCh7Y29sdW1uTmFtZSwgY29sdW1uVHlwZSwgdmFsdWV9KSB7XG4gICAgaWYgKHRoaXMuX2RlY2xhcmVkQXR0cmlidXRlQ2FzdEZvckNvbHVtbihjb2x1bW5OYW1lKSA9PT0gXCJib29sZWFuXCIpIHtcbiAgICAgIHJldHVybiB0aGlzLl9jYXN0RGVjbGFyZWRCb29sZWFuRm9yUmVhZCh2YWx1ZSlcbiAgICB9XG5cbiAgICBpZiAoIWNvbHVtblR5cGUpIHJldHVybiB2YWx1ZVxuICAgIGlmIChjb2x1bW5UeXBlLnRvTG93ZXJDYXNlKCkgIT09IFwiYm9vbGVhblwiKSByZXR1cm4gdmFsdWVcbiAgICBpZiAodmFsdWUgPT09IDEpIHJldHVybiB0cnVlXG4gICAgaWYgKHZhbHVlID09PSAwKSByZXR1cm4gZmFsc2VcblxuICAgIHJldHVybiB2YWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIGRhdGUgdmFsdWUgZm9yIHJlYWQuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUgZnJvbSBkYXRhYmFzZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIE5vcm1hbGl6ZWQgdmFsdWUuXG4gICAqL1xuICBfbm9ybWFsaXplRGF0ZVZhbHVlRm9yUmVhZCh2YWx1ZSkge1xuICAgIHJldHVybiBub3JtYWxpemVEYXRlVmFsdWVGb3JSZWFkKHZhbHVlLCB7ZGF0YWJhc2VUeXBlOiB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXREYXRhYmFzZVR5cGUoKX0pXG4gIH1cblxuICBfYmVsb25nc1RvQ2hhbmdlcygpIHtcbiAgICAvKipcbiAgICAgKiBCZWxvbmdzIHRvIGNoYW5nZXMuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBiZWxvbmdzVG9DaGFuZ2VzID0ge31cblxuICAgIGlmICh0aGlzLl9pbnN0YW5jZVJlbGF0aW9uc2hpcHMpIHtcbiAgICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBpbiB0aGlzLl9pbnN0YW5jZVJlbGF0aW9uc2hpcHMpIHtcbiAgICAgICAgY29uc3QgcmVsYXRpb25zaGlwID0gdGhpcy5faW5zdGFuY2VSZWxhdGlvbnNoaXBzW3JlbGF0aW9uc2hpcE5hbWVdXG5cbiAgICAgICAgaWYgKHJlbGF0aW9uc2hpcC5nZXRUeXBlKCkgPT0gXCJiZWxvbmdzVG9cIiAmJiByZWxhdGlvbnNoaXAuZ2V0RGlydHkoKSkge1xuICAgICAgICAgIGNvbnN0IG1vZGVsID0gcmVsYXRpb25zaGlwLmdldExvYWRlZE9yVW5kZWZpbmVkKClcblxuICAgICAgICAgIGlmIChtb2RlbCkge1xuICAgICAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkobW9kZWwpKSB0aHJvdyBuZXcgRXJyb3IoXCJVbmV4cGVjdGVkIGJlbG9uZ3MtdG8gbW9kZWwgYXJyYXlcIilcblxuICAgICAgICAgICAgYmVsb25nc1RvQ2hhbmdlc1tyZWxhdGlvbnNoaXAuZ2V0Rm9yZWlnbktleSgpXSA9IHRoaXMuX2JlbG9uZ3NUb0ZvcmVpZ25LZXlWYWx1ZSh7bW9kZWwsIHJlbGF0aW9uc2hpcH0pXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGJlbG9uZ3NUb0NoYW5nZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNyZWF0ZSBuZXcgcmVjb3JkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2NyZWF0ZU5ld1JlY29yZCgpIHtcbiAgICAvLyBSZXNvbHZlIHRoZSBjb25uZWN0aW9uIG9uY2UgYW5kIHBpbiB0aGUgd2hvbGUgaW5zZXJ0IHBhdGggdG8gaXQ6IGEgcG9vbFxuICAgIC8vIGNhbiByZXNvbHZlIGEgZGlmZmVyZW50IGN1cnJlbnQgY29ubmVjdGlvbiBhY3Jvc3MgdGhlIGF3YWl0cyBiZWxvdywgYW5kXG4gICAgLy8gdGhlIGlkZW50aXR5LWluc2VydCB3cmFwcGVyIGlzIG9ubHkgZWZmZWN0aXZlIG9uIHRoZSBleGFjdCBzZXNzaW9uIHRoYXRcbiAgICAvLyByYW4gU0VUIElERU5USVRZX0lOU0VSVC5cbiAgICBjb25zdCBjb25uZWN0aW9uID0gdGhpcy5fY29ubmVjdGlvbigpXG5cbiAgICBpZiAoIWNvbm5lY3Rpb25bXCJpbnNlcnRTcWxcIl0pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gaW5zZXJ0U3FsIG9uICR7Y29ubmVjdGlvbi5jb25zdHJ1Y3Rvci5uYW1lfWApXG4gICAgfVxuXG4gICAgY29uc3QgZGF0YSA9IE9iamVjdC5hc3NpZ24oe30sIHRoaXMuX2JlbG9uZ3NUb0NoYW5nZXMoKSwgdGhpcy5yYXdBdHRyaWJ1dGVzKCkpXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLnByaW1hcnlLZXkoKVxuICAgIGNvbnN0IHByaW1hcnlLZXlDb2x1bW4gPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRDb2x1bW5zKCkuZmluZCgoY29sdW1uKSA9PiBjb2x1bW4uZ2V0TmFtZSgpID09IHByaW1hcnlLZXkpXG4gICAgY29uc3QgcHJpbWFyeUtleVR5cGUgPSBwcmltYXJ5S2V5Q29sdW1uPy5nZXRUeXBlKCk/LnRvTG93ZXJDYXNlKClcbiAgICBjb25zdCBkcml2ZXJTdXBwb3J0c0RlZmF1bHRVVUlEID0gdHlwZW9mIGNvbm5lY3Rpb24uc3VwcG9ydHNEZWZhdWx0UHJpbWFyeUtleVVVSUQgPT0gXCJmdW5jdGlvblwiICYmIGNvbm5lY3Rpb24uc3VwcG9ydHNEZWZhdWx0UHJpbWFyeUtleVVVSUQoKVxuICAgIGNvbnN0IGlzVVVJRFByaW1hcnlLZXkgPSBwcmltYXJ5S2V5VHlwZT8uaW5jbHVkZXMoXCJ1dWlkXCIpXG4gICAgY29uc3Qgc2hvdWxkQXNzaWduVVVJRFByaW1hcnlLZXkgPSBpc1VVSURQcmltYXJ5S2V5ICYmICFkcml2ZXJTdXBwb3J0c0RlZmF1bHRVVUlEXG4gICAgdGhpcy5fc2V0RGVmYXVsdFRpbWVzdGFtcFZhbHVlcyhkYXRhKVxuXG4gICAgY29uc3QgY29sdW1uTmFtZXMgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRDb2x1bW5OYW1lcygpXG4gICAgY29uc3QgaGFzVXNlclByb3ZpZGVkUHJpbWFyeUtleSA9IGRhdGFbcHJpbWFyeUtleV0gIT09IHVuZGVmaW5lZCAmJiBkYXRhW3ByaW1hcnlLZXldICE9PSBudWxsICYmIGRhdGFbcHJpbWFyeUtleV0gIT09IFwiXCJcblxuICAgIGlmIChzaG91bGRBc3NpZ25VVUlEUHJpbWFyeUtleSAmJiAhaGFzVXNlclByb3ZpZGVkUHJpbWFyeUtleSkge1xuICAgICAgZGF0YVtwcmltYXJ5S2V5XSA9IG5ldyBVVUlEKDQpLmZvcm1hdCgpXG4gICAgfVxuXG4gICAgdGhpcy5fbm9ybWFsaXplRGF0ZVZhbHVlc0ZvcldyaXRlKGRhdGEpXG5cbiAgICBjb25zdCBzcWwgPSBjb25uZWN0aW9uLmluc2VydFNxbCh7XG4gICAgICByZXR1cm5MYXN0SW5zZXJ0ZWRDb2x1bW5OYW1lczogY29sdW1uTmFtZXMsXG4gICAgICB0YWJsZU5hbWU6IHRoaXMuX3RhYmxlTmFtZSgpLFxuICAgICAgZGF0YVxuICAgIH0pXG4gICAgY29uc3QgaW5zZXJ0T3B0aW9ucyA9IHtsb2dOYW1lOiBgJHt0aGlzLmdldE1vZGVsQ2xhc3MoKS5uYW1lfSBDcmVhdGVgfVxuICAgIC8vIEV4cGxpY2l0IHByaW1hcnkta2V5IGluc2VydHMgaW50byBhdXRvLWluY3JlbWVudCBjb2x1bW5zIGdvIHRocm91Z2ggdGhlXG4gICAgLy8gZHJpdmVyJ3MgZXhwbGljaXQtcHJpbWFyeS1rZXkgaW5zZXJ0IChNU1NRTCB3cmFwcyBpdCBpbiBJREVOVElUWV9JTlNFUlQpO1xuICAgIC8vIGV2ZXJ5dGhpbmcgZWxzZSB1c2VzIHRoZSBwbGFpbiBxdWVyeSBwYXRoLlxuICAgIGNvbnN0IGluc2VydFJlc3VsdCA9IGhhc1VzZXJQcm92aWRlZFByaW1hcnlLZXkgJiYgcHJpbWFyeUtleUNvbHVtbj8uZ2V0QXV0b0luY3JlbWVudCgpID09PSB0cnVlXG4gICAgICA/IGF3YWl0IGNvbm5lY3Rpb24uaW5zZXJ0V2l0aEV4cGxpY2l0UHJpbWFyeUtleSh7b3B0aW9uczogaW5zZXJ0T3B0aW9ucywgc3FsLCB0YWJsZU5hbWU6IHRoaXMuX3RhYmxlTmFtZSgpfSlcbiAgICAgIDogYXdhaXQgY29ubmVjdGlvbi5xdWVyeShzcWwsIGluc2VydE9wdGlvbnMpXG5cbiAgICBhd2FpdCB0aGlzLl9hcHBseUluc2VydFJlc3VsdCh7Y29ubmVjdGlvbiwgZGF0YSwgaW5zZXJ0UmVzdWx0LCBwcmltYXJ5S2V5fSlcbiAgICB0aGlzLnNldElzTmV3UmVjb3JkKGZhbHNlKVxuXG4gICAgdGhpcy5fbWFya0xvYWRlZFJlbGF0aW9uc2hpcHNQcmVsb2FkZWRBZnRlckNyZWF0ZSgpXG4gIH1cblxuICAvKipcbiAgICogTWFya3Mgb25seSByZWxhdGlvbnNoaXBzIHdpdGggaW4tbWVtb3J5IGxvYWRlZCB2YWx1ZXMgYXMgcHJlbG9hZGVkIGFmdGVyIGNyZWF0ZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX21hcmtMb2FkZWRSZWxhdGlvbnNoaXBzUHJlbG9hZGVkQWZ0ZXJDcmVhdGUoKSB7XG4gICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXAgb2YgdGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0UmVsYXRpb25zaGlwcygpKSB7XG4gICAgICBjb25zdCBpbnN0YW5jZVJlbGF0aW9uc2hpcCA9IHRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcC5nZXRSZWxhdGlvbnNoaXBOYW1lKCkpXG5cbiAgICAgIGlmIChpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRUeXBlKCkgPT0gXCJoYXNNYW55XCIgJiYgaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0TG9hZGVkT3JVbmRlZmluZWQoKSA9PT0gbnVsbCkge1xuICAgICAgICBpbnN0YW5jZVJlbGF0aW9uc2hpcC5zZXRMb2FkZWQoW10pXG4gICAgICB9XG5cbiAgICAgIGlmIChpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRMb2FkZWRPclVuZGVmaW5lZCgpICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgaW5zdGFuY2VSZWxhdGlvbnNoaXAuc2V0UHJlbG9hZGVkKHRydWUpXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFwcGxpZXMgdGhlIGRhdGFiYXNlIGluc2VydCByZXNwb25zZSB0byB0aGlzIHJlY29yZC5cbiAgICogQHBhcmFtIHt7Y29ubmVjdGlvbjogaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQsIGRhdGE6IFJlY29yZDxzdHJpbmcsIHN0cmluZyB8IG51bWJlciB8IGJvb2xlYW4gfCBEYXRlIHwgbnVsbCB8IHVuZGVmaW5lZD4sIGluc2VydFJlc3VsdDogQXJyYXk8UmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbiB8IERhdGUgfCBudWxsIHwgdW5kZWZpbmVkPj4gfCBudWxsIHwgdW5kZWZpbmVkLCBwcmltYXJ5S2V5OiBzdHJpbmd9fSBvcHRpb25zIC0gUGlubmVkIGluc2VydCBjb25uZWN0aW9uLCBpbnNlcnRlZCBkYXRhLCBjb25uZWN0aW9uIHJlc3VsdCwgYW5kIHByaW1hcnkga2V5IGNvbHVtbiBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX2FwcGx5SW5zZXJ0UmVzdWx0KHtjb25uZWN0aW9uLCBkYXRhLCBpbnNlcnRSZXN1bHQsIHByaW1hcnlLZXl9KSB7XG4gICAgaWYgKEFycmF5LmlzQXJyYXkoaW5zZXJ0UmVzdWx0KSAmJiBpbnNlcnRSZXN1bHRbMF0gJiYgaW5zZXJ0UmVzdWx0WzBdW3ByaW1hcnlLZXldKSB7XG4gICAgICB0aGlzLl9hdHRyaWJ1dGVzID0gaW5zZXJ0UmVzdWx0WzBdXG4gICAgICB0aGlzLl9jaGFuZ2VzID0ge31cbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgcHJpbWFyeUtleVZhbHVlID0gZGF0YVtwcmltYXJ5S2V5XVxuXG4gICAgICBpZiAocHJpbWFyeUtleVZhbHVlICE9PSB1bmRlZmluZWQgJiYgcHJpbWFyeUtleVZhbHVlICE9PSBudWxsICYmIHByaW1hcnlLZXlWYWx1ZSAhPT0gXCJcIikge1xuICAgICAgICBpZiAodHlwZW9mIHByaW1hcnlLZXlWYWx1ZSAhPSBcInN0cmluZ1wiICYmIHR5cGVvZiBwcmltYXJ5S2V5VmFsdWUgIT0gXCJudW1iZXJcIikge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgSW5zZXJ0ZWQgcHJpbWFyeSBrZXkgJHtwcmltYXJ5S2V5fSBtdXN0IGJlIGEgc3RyaW5nIG9yIG51bWJlciwgZ290ICR7dHlwZW9mIHByaW1hcnlLZXlWYWx1ZX1gKVxuICAgICAgICB9XG5cbiAgICAgICAgYXdhaXQgdGhpcy5fcmVsb2FkV2l0aElkKHByaW1hcnlLZXlWYWx1ZSlcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGlkID0gYXdhaXQgY29ubmVjdGlvbi5sYXN0SW5zZXJ0SUQoKVxuXG4gICAgICBhd2FpdCB0aGlzLl9yZWxvYWRXaXRoSWQoaWQpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFNldHMgdGltZXN0YW1wIGRlZmF1bHRzIGZvciBhIG5ldyByZWNvcmQgaW5zZXJ0LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gZGF0YSAtIENvbHVtbi1rZXllZCBkYXRhLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfc2V0RGVmYXVsdFRpbWVzdGFtcFZhbHVlcyhkYXRhKSB7XG4gICAgY29uc3QgY3JlYXRlZEF0Q29sdW1uID0gdGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0Q29sdW1ucygpLmZpbmQoKGNvbHVtbikgPT4gY29sdW1uLmdldE5hbWUoKSA9PSBcImNyZWF0ZWRfYXRcIilcbiAgICBjb25zdCB1cGRhdGVkQXRDb2x1bW4gPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRDb2x1bW5zKCkuZmluZCgoY29sdW1uKSA9PiBjb2x1bW4uZ2V0TmFtZSgpID09IFwidXBkYXRlZF9hdFwiKVxuICAgIGNvbnN0IGN1cnJlbnREYXRlID0gbmV3IERhdGUoKVxuXG4gICAgaWYgKGNyZWF0ZWRBdENvbHVtbiAmJiAoZGF0YS5jcmVhdGVkX2F0ID09PSB1bmRlZmluZWQgfHwgZGF0YS5jcmVhdGVkX2F0ID09PSBudWxsIHx8IGRhdGEuY3JlYXRlZF9hdCA9PT0gXCJcIikpIHtcbiAgICAgIGRhdGEuY3JlYXRlZF9hdCA9IGN1cnJlbnREYXRlXG4gICAgfVxuICAgIGlmICh1cGRhdGVkQXRDb2x1bW4gJiYgKGRhdGEudXBkYXRlZF9hdCA9PT0gdW5kZWZpbmVkIHx8IGRhdGEudXBkYXRlZF9hdCA9PT0gbnVsbCB8fCBkYXRhLnVwZGF0ZWRfYXQgPT09IFwiXCIpKSB7XG4gICAgICBkYXRhLnVwZGF0ZWRfYXQgPSBjdXJyZW50RGF0ZVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBkYXRlIHZhbHVlcyBmb3Igd3JpdGUuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBkYXRhIC0gQ29sdW1uLWtleWVkIGRhdGEuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9ub3JtYWxpemVEYXRlVmFsdWVzRm9yV3JpdGUoZGF0YSkge1xuICAgIGZvciAoY29uc3QgY29sdW1uTmFtZSBpbiBkYXRhKSB7XG4gICAgICBjb25zdCBjb2x1bW5UeXBlID0gdGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0Q29sdW1uVHlwZUJ5TmFtZShjb2x1bW5OYW1lKVxuXG4gICAgICBpZiAoIWNvbHVtblR5cGUgfHwgIXRoaXMuZ2V0TW9kZWxDbGFzcygpLl9pc0RhdGVMaWtlVHlwZShjb2x1bW5UeXBlKSkgY29udGludWVcblxuICAgICAgY29uc3QgdmFsdWUgPSBkYXRhW2NvbHVtbk5hbWVdXG5cbiAgICAgIGRhdGFbY29sdW1uTmFtZV0gPSBub3JtYWxpemVEYXRlVmFsdWVGb3JXcml0ZSh2YWx1ZSwge3RpbWVab25lOiB0aGlzLmdldE1vZGVsQ2xhc3MoKS5fdGltZVpvbmVGb3JEYXRlV3JpdGUoKX0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdXBkYXRlIHJlY29yZCB3aXRoIGNoYW5nZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfdXBkYXRlUmVjb3JkV2l0aENoYW5nZXMoKSB7XG4gICAgLyoqXG4gICAgICogQ29uZGl0aW9ucy5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGNvbmRpdGlvbnMgPSB7fVxuXG4gICAgY29uZGl0aW9uc1t0aGlzLmdldE1vZGVsQ2xhc3MoKS5wcmltYXJ5S2V5KCldID0gdGhpcy5pZCgpXG5cbiAgICBjb25zdCBjaGFuZ2VzID0gT2JqZWN0LmFzc2lnbih7fSwgdGhpcy5fYmVsb25nc1RvQ2hhbmdlcygpLCB0aGlzLl9jaGFuZ2VzKVxuICAgIGNvbnN0IHVwZGF0ZWRBdENvbHVtbiA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldENvbHVtbnMoKS5maW5kKChjb2x1bW4pID0+IGNvbHVtbi5nZXROYW1lKCkgPT0gXCJ1cGRhdGVkX2F0XCIpXG4gICAgY29uc3QgY3VycmVudERhdGUgPSBuZXcgRGF0ZSgpXG5cbiAgICBpZiAodXBkYXRlZEF0Q29sdW1uICYmIChjaGFuZ2VzLnVwZGF0ZWRfYXQgPT09IHVuZGVmaW5lZCB8fCBjaGFuZ2VzLnVwZGF0ZWRfYXQgPT09IG51bGwgfHwgY2hhbmdlcy51cGRhdGVkX2F0ID09PSBcIlwiKSkge1xuICAgICAgY2hhbmdlcy51cGRhdGVkX2F0ID0gY3VycmVudERhdGVcbiAgICB9XG5cbiAgICBpZiAoT2JqZWN0LmtleXMoY2hhbmdlcykubGVuZ3RoID4gMCkge1xuICAgICAgdGhpcy5fbm9ybWFsaXplRGF0ZVZhbHVlc0ZvcldyaXRlKGNoYW5nZXMpXG4gICAgICBjb25zdCBzcWwgPSB0aGlzLl9jb25uZWN0aW9uKCkudXBkYXRlU3FsKHtcbiAgICAgICAgdGFibGVOYW1lOiB0aGlzLl90YWJsZU5hbWUoKSxcbiAgICAgICAgZGF0YTogY2hhbmdlcyxcbiAgICAgICAgY29uZGl0aW9uc1xuICAgICAgfSlcbiAgICAgIGF3YWl0IHRoaXMuX2Nvbm5lY3Rpb24oKS5xdWVyeShzcWwsIHtsb2dOYW1lOiBgJHt0aGlzLmdldE1vZGVsQ2xhc3MoKS5uYW1lfSBVcGRhdGVgfSlcbiAgICAgIGF3YWl0IHRoaXMuX3JlbG9hZFdpdGhJZCh0aGlzLmlkKCkpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaWQuXG4gICAqIEByZXR1cm5zIHtudW1iZXJ8c3RyaW5nfSAtIFRoZSBpZC5cbiAgICovXG4gIGlkKCkge1xuICAgIGlmICghdGhpcy5nZXRNb2RlbENsYXNzKCkuX2NvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ29sdW1uIG5hbWVzIG1hcHBpbmcgaGFzbid0IGJlZW4gc2V0IG9uICR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfS4gSGFzIHRoZSBtb2RlbCBiZWVuIGluaXRpYWxpemVkP2ApXG4gICAgfVxuXG4gICAgY29uc3QgcHJpbWFyeUtleSA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLnByaW1hcnlLZXkoKVxuICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWUgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKClbcHJpbWFyeUtleV1cblxuICAgIGlmIChhdHRyaWJ1dGVOYW1lID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgUHJpbWFyeSBrZXkgJHtwcmltYXJ5S2V5fSBkb2Vzbid0IGV4aXN0IGluIGNvbHVtbnM6ICR7T2JqZWN0LmtleXModGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCgpKS5qb2luKFwiLCBcIil9YClcbiAgICB9XG5cbiAgICByZXR1cm4gLyoqIEB0eXBlIHtudW1iZXIgfCBzdHJpbmd9ICovICh0aGlzLnJlYWRBdHRyaWJ1dGUoYXR0cmlidXRlTmFtZSkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBwZXJzaXN0ZWQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgcGVyc2lzdGVkLlxuICAgKi9cbiAgaXNQZXJzaXN0ZWQoKSB7IHJldHVybiAhdGhpcy5faXNOZXdSZWNvcmQgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIG5ldyByZWNvcmQuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgbmV3IHJlY29yZC5cbiAgICovXG4gIGlzTmV3UmVjb3JkKCkgeyByZXR1cm4gdGhpcy5faXNOZXdSZWNvcmQgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBpcyBuZXcgcmVjb3JkLlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IG5ld0lzTmV3UmVjb3JkIC0gTmV3IGlzIG5ldyByZWNvcmQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldElzTmV3UmVjb3JkKG5ld0lzTmV3UmVjb3JkKSB7XG4gICAgdGhpcy5faXNOZXdSZWNvcmQgPSBuZXdJc05ld1JlY29yZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVsb2FkIHdpdGggaWQuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAcGFyYW0ge3N0cmluZyB8IG51bWJlcn0gaWQgLSBSZWNvcmQgaWRlbnRpZmllci5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF9yZWxvYWRXaXRoSWQoaWQpIHtcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gdGhpcy5nZXRNb2RlbENsYXNzKCkucHJpbWFyeUtleSgpXG5cbiAgICAvKipcbiAgICAgKiBXaGVyZSBvYmplY3QuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCB3aGVyZU9iamVjdCA9IHt9XG5cbiAgICB3aGVyZU9iamVjdFtwcmltYXJ5S2V5XSA9IGlkXG5cbiAgICBjb25zdCBxdWVyeSA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDxNQz59ICovIChcbiAgICAgIHRoaXNcbiAgICAgICAgLnF1ZXJ5Rm9yTW9kZWwodGhpcy5nZXRNb2RlbENsYXNzKCkpXG4gICAgICAgIC53aGVyZSh3aGVyZU9iamVjdClcbiAgICApXG4gICAgY29uc3QgcmVsb2FkZWRNb2RlbCA9IGF3YWl0IHF1ZXJ5LmZpcnN0KClcblxuICAgIGlmICghcmVsb2FkZWRNb2RlbCkgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMuY29uc3RydWN0b3IubmFtZX0jJHtpZH0gY291bGRuJ3QgYmUgcmVsb2FkZWQgLSByZWNvcmQgZGlkbid0IGV4aXN0YClcblxuICAgIHRoaXMuX2F0dHJpYnV0ZXMgPSByZWxvYWRlZE1vZGVsLnJhd0F0dHJpYnV0ZXMoKVxuICAgIHRoaXMuX2NoYW5nZXMgPSB7fVxuICAgIHRoaXMuX2Fzc2lnbmVkQXR0cmlidXRlTmFtZXMgPSB1bmRlZmluZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIHJlbG9hZCgpIHtcbiAgICBjb25zdCByZWNvcmRJZCA9IC8qKiBAdHlwZSB7c3RyaW5nIHwgbnVtYmVyfSAqLyAodGhpcy5yZWFkQXR0cmlidXRlKFwiaWRcIikpXG4gICAgYXdhaXQgdGhpcy5fcmVsb2FkV2l0aElkKHJlY29yZElkKVxuICB9XG5cbiAgYXN5bmMgX3J1blZhbGlkYXRpb25zKCkge1xuICAgIC8qKlxuICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywge3R5cGU6IHN0cmluZywgbWVzc2FnZTogc3RyaW5nfT59ICovXG4gICAgdGhpcy5fdmFsaWRhdGlvbkVycm9ycyA9IHt9XG5cbiAgICBjb25zdCB2YWxpZGF0b3JzID0gdGhpcy5nZXRNb2RlbENsYXNzKCkuX3ZhbGlkYXRvcnNcblxuICAgIGlmICh2YWxpZGF0b3JzKSB7XG4gICAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZU5hbWUgaW4gdmFsaWRhdG9ycykge1xuICAgICAgICBjb25zdCBhdHRyaWJ1dGVWYWxpZGF0b3JzID0gdmFsaWRhdG9yc1thdHRyaWJ1dGVOYW1lXVxuXG4gICAgICAgIGZvciAoY29uc3QgdmFsaWRhdG9yIG9mIGF0dHJpYnV0ZVZhbGlkYXRvcnMpIHtcbiAgICAgICAgICBhd2FpdCB2YWxpZGF0b3IudmFsaWRhdGUoe21vZGVsOiB0aGlzLCBhdHRyaWJ1dGVOYW1lfSlcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChPYmplY3Qua2V5cyh0aGlzLl92YWxpZGF0aW9uRXJyb3JzKS5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCB2YWxpZGF0aW9uRXJyb3IgPSBuZXcgVmFsaWRhdGlvbkVycm9yKHRoaXMuZnVsbEVycm9yTWVzc2FnZXMoKS5qb2luKFwiLiBcIikpXG5cbiAgICAgIHZhbGlkYXRpb25FcnJvci5zZXRWYWxpZGF0aW9uRXJyb3JzKHRoaXMuX3ZhbGlkYXRpb25FcnJvcnMpXG4gICAgICB2YWxpZGF0aW9uRXJyb3Iuc2V0TW9kZWwodGhpcylcbiAgICAgIHZhbGlkYXRpb25FcnJvci52ZWxvY2lvdXMgPSB7dHlwZTogXCJ2YWxpZGF0aW9uX2Vycm9yXCJ9XG5cbiAgICAgIHRocm93IHZhbGlkYXRpb25FcnJvclxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZ1bGwgZXJyb3IgbWVzc2FnZXMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmdbXX0gLSBUaGUgZnVsbCBlcnJvciBtZXNzYWdlcy5cbiAgICovXG4gIGZ1bGxFcnJvck1lc3NhZ2VzKCkge1xuICAgIC8qKlxuICAgICAqIFZhbGlkYXRpb24gZXJyb3IgbWVzc2FnZXMuXG4gICAgICogQHR5cGUge3N0cmluZ1tdfSAqL1xuICAgIGNvbnN0IHZhbGlkYXRpb25FcnJvck1lc3NhZ2VzID0gW11cblxuICAgIGlmICh0aGlzLl92YWxpZGF0aW9uRXJyb3JzKSB7XG4gICAgICBmb3IgKGNvbnN0IGF0dHJpYnV0ZU5hbWUgaW4gdGhpcy5fdmFsaWRhdGlvbkVycm9ycykge1xuICAgICAgICBmb3IgKGNvbnN0IHZhbGlkYXRpb25FcnJvciBvZiB0aGlzLl92YWxpZGF0aW9uRXJyb3JzW2F0dHJpYnV0ZU5hbWVdKSB7XG4gICAgICAgICAgY29uc3QgbWVzc2FnZSA9IGAke3RoaXMuZ2V0TW9kZWxDbGFzcygpLmh1bWFuQXR0cmlidXRlTmFtZShhdHRyaWJ1dGVOYW1lKX0gJHt2YWxpZGF0aW9uRXJyb3IubWVzc2FnZX1gXG5cbiAgICAgICAgICB2YWxpZGF0aW9uRXJyb3JNZXNzYWdlcy5wdXNoKG1lc3NhZ2UpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdmFsaWRhdGlvbkVycm9yTWVzc2FnZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBBc3NpZ25zIHRoZSBhdHRyaWJ1dGVzIHRvIHRoZSByZWNvcmQgYW5kIHNhdmVzIGl0LlxuICAgKiBAcGFyYW0ge1dyaXRlQXR0cmlidXRlc30gYXR0cmlidXRlc1RvQXNzaWduIC0gVGhlIGF0dHJpYnV0ZXMgdG8gYXNzaWduIHRvIHRoZSByZWNvcmQuXG4gICAqL1xuICBhc3luYyB1cGRhdGUoYXR0cmlidXRlc1RvQXNzaWduKSB7XG4gICAgaWYgKGF0dHJpYnV0ZXNUb0Fzc2lnbikgdGhpcy5hc3NpZ24oYXR0cmlidXRlc1RvQXNzaWduKVxuXG4gICAgYXdhaXQgdGhpcy5zYXZlKClcbiAgfVxufVxuXG5WZWxvY2lvdXNEYXRhYmFzZVJlY29yZC5yZWdpc3RlclZhbGlkYXRvclR5cGUoXCJmb3JtYXRcIiwgVmFsaWRhdG9yc0Zvcm1hdClcblZlbG9jaW91c0RhdGFiYXNlUmVjb3JkLnJlZ2lzdGVyVmFsaWRhdG9yVHlwZShcImxlbmd0aFwiLCBWYWxpZGF0b3JzTGVuZ3RoKVxuVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQucmVnaXN0ZXJWYWxpZGF0b3JUeXBlKFwicHJlc2VuY2VcIiwgVmFsaWRhdG9yc1ByZXNlbmNlKVxuVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQucmVnaXN0ZXJWYWxpZGF0b3JUeXBlKFwidW5pcXVlbmVzc1wiLCBWYWxpZGF0b3JzVW5pcXVlbmVzcylcblxuZXhwb3J0IHtBZHZpc29yeUxvY2tCdXN5RXJyb3IsIEFkdmlzb3J5TG9ja0hvbGRUaW1lb3V0RXJyb3IsIEFkdmlzb3J5TG9ja1RpbWVvdXRFcnJvciwgVGVuYW50RGF0YWJhc2VTY29wZUVycm9yLCBWYWxpZGF0aW9uRXJyb3J9XG5leHBvcnQgZGVmYXVsdCBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZFxuIl19