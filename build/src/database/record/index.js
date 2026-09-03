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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcmVjb3JkL2luZGV4LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWjs7O0dBR0c7QUFFSDs7OztHQUlHO0FBRUg7Ozs7R0FJRztBQUVIOzs7R0FHRztBQUVILDhHQUE4RztBQUU5Rzs7O0dBR0c7QUFFSCxPQUFPLGtCQUFrQixFQUFFLEVBQUMscUJBQXFCLEVBQUUsNEJBQTRCLEVBQUUsd0JBQXdCLEVBQUMsTUFBTSw0QkFBNEIsQ0FBQTtBQUM1SSxPQUFPLDZCQUE2QixNQUFNLHdDQUF3QyxDQUFBO0FBQ2xGLE9BQU8scUJBQXFCLE1BQU0sK0JBQStCLENBQUE7QUFDakUsT0FBTyxhQUFhLE1BQU0sd0JBQXdCLENBQUE7QUFDbEQsT0FBTyxPQUFPLE1BQU0sa0JBQWtCLENBQUE7QUFDdEMsT0FBTyxTQUFTLE1BQU0sd0JBQXdCLENBQUE7QUFDOUMsT0FBTyxPQUFPLE1BQU0sZUFBZSxDQUFBO0FBQ25DLE9BQU8sMkJBQTJCLE1BQU0sc0NBQXNDLENBQUE7QUFDOUUsT0FBTyxtQkFBbUIsTUFBTSw2QkFBNkIsQ0FBQTtBQUM3RCxPQUFPLDBCQUEwQixNQUFNLHFDQUFxQyxDQUFBO0FBQzVFLE9BQU8sa0JBQWtCLE1BQU0sNEJBQTRCLENBQUE7QUFDM0QsT0FBTyxzQkFBc0IsTUFBTSx5QkFBeUIsQ0FBQTtBQUM1RCxPQUFPLEtBQUssVUFBVSxNQUFNLFlBQVksQ0FBQTtBQUN4QyxPQUFPLGdCQUFnQixNQUFNLG1DQUFtQyxDQUFBO0FBQ2hFLE9BQU8sZUFBZSxNQUFNLCtCQUErQixDQUFBO0FBQzNELE9BQU8sU0FBUyxNQUFNLHVCQUF1QixDQUFBO0FBQzdDLE9BQU8sRUFBQywyQkFBMkIsRUFBRSwwQkFBMEIsRUFBRSxvQkFBb0IsRUFBRSwwQkFBMEIsRUFBRSx5QkFBeUIsRUFBRSxtQkFBbUIsRUFBQyxNQUFNLGdDQUFn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SUFFRDs7O09BR0c7SUFDSCxLQUFLLENBQUMsTUFBTSxDQUFDLGtCQUFrQjtRQUM3QixJQUFJLGtCQUFrQjtZQUFFLElBQUksQ0FBQyxNQUFNLENBQUMsa0JBQWtCLENBQUMsQ0FBQTtRQUV2RCxNQUFNLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQTtJQUNuQixDQUFDO0NBQ0Y7QUFFRCx1QkFBdUIsQ0FBQyxxQkFBcUIsQ0FBQyxRQUFRLEVBQUUsZ0JBQWdCLENBQUMsQ0FBQTtBQUN6RSx1QkFBdUIsQ0FBQyxxQkFBcUIsQ0FBQyxRQUFRLEVBQUUsZ0JBQWdCLENBQUMsQ0FBQTtBQUN6RSx1QkFBdUIsQ0FBQyxxQkFBcUIsQ0FBQyxVQUFVLEVBQUUsa0JBQWtCLENBQUMsQ0FBQTtBQUM3RSx1QkFBdUIsQ0FBQyxxQkFBcUIsQ0FBQyxZQUFZLEVBQUUsb0JBQW9CLENBQUMsQ0FBQTtBQUVqRixPQUFPLEVBQUMscUJBQXFCLEVBQUUsNEJBQTRCLEVBQUUsd0JBQXdCLEVBQUUsd0JBQXdCLEVBQUUsZUFBZSxFQUFDLENBQUE7QUFDakksZUFBZSx1QkFBdUIsQ0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG4vKipcbiAqIERlZmluZXMgdGhpcyB0eXBlZGVmLlxuICogQHR5cGVkZWYge3t0eXBlOiBzdHJpbmcsIG1lc3NhZ2U6IHN0cmluZ319IFZhbGlkYXRpb25FcnJvck9iamVjdFR5cGVcbiAqL1xuXG4vKipcbiAqIExpZmVjeWNsZUNhbGxiYWNrVHlwZSB0eXBlLlxuICogQHRlbXBsYXRlIFtUPVZlbG9jaW91c0RhdGFiYXNlUmVjb3JkXVxuICogQHR5cGVkZWYgeygobW9kZWw6IFQpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+KSB8IHN0cmluZ30gTGlmZWN5Y2xlQ2FsbGJhY2tUeXBlXG4gKi9cblxuLyoqXG4gKiBNb2RlbCBjbGFzcyBjb25zdHJ1Y3RvciB0eXBlIHVzZWQgZm9yIHN0YXRpYyBgdGhpc2AgdHlwaW5nLlxuICogQHRlbXBsYXRlIFRcbiAqIEB0eXBlZGVmIHt7bmV3IChjaGFuZ2VzPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiBUfX0gTW9kZWxDb25zdHJ1Y3RvclxuICovXG5cbi8qKlxuICogUmVzdHJpY3RJbnN0YW5jZVJlbGF0aW9uc2hpcCB0eXBlLlxuICogQHR5cGVkZWYge2ltcG9ydChcIi4vaW5zdGFuY2UtcmVsYXRpb25zaGlwcy9iYXNlLmpzXCIpLmRlZmF1bHQgJiB7cXVlcnk6ICgpID0+IE1vZGVsQ2xhc3NRdWVyeTx0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQ+fX0gUmVzdHJpY3RJbnN0YW5jZVJlbGF0aW9uc2hpcFxuICovXG5cbi8qKiBAdHlwZWRlZiB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5UZW5hbnREYXRhYmFzZVByb3ZpZGVyVHlwZX0gVGVuYW50RGF0YWJhc2VQcm92aWRlclR5cGUgKi9cblxuLyoqXG4gKiBTY2hlbWEgbWV0YWRhdGEgY2FjaGVkIGZvciBvbmUgcmVjb3JkIGNsYXNzIGFuZCBwaHlzaWNhbCBkYXRhYmFzZSBnZW5lcmF0aW9uLlxuICogQHR5cGVkZWYge2Jvb2xlYW4gfCBudWxsIHwgc3RyaW5nIHwgdW5kZWZpbmVkIHwgUHJvbWlzZTx2b2lkPiB8IHN0cmluZ1tdIHwgaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLWNvbHVtbi5qc1wiKS5kZWZhdWx0W10gfCBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UtdGFibGUuanNcIikuZGVmYXVsdCB8IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gfCBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCB1bmRlZmluZWQ+IHwgUmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLWNvbHVtbi5qc1wiKS5kZWZhdWx0Pn0gUmVjb3JkTWV0YWRhdGFWYWx1ZVxuICovXG5cbmltcG9ydCBBZHZpc29yeUxvY2tSdW5uZXIsIHtBZHZpc29yeUxvY2tCdXN5RXJyb3IsIEFkdmlzb3J5TG9ja0hvbGRUaW1lb3V0RXJyb3IsIEFkdmlzb3J5TG9ja1RpbWVvdXRFcnJvcn0gZnJvbSBcIi4uL2Fkdmlzb3J5LWxvY2stcnVubmVyLmpzXCJcbmltcG9ydCBCZWxvbmdzVG9JbnN0YW5jZVJlbGF0aW9uc2hpcCBmcm9tIFwiLi9pbnN0YW5jZS1yZWxhdGlvbnNoaXBzL2JlbG9uZ3MtdG8uanNcIlxuaW1wb3J0IEJlbG9uZ3NUb1JlbGF0aW9uc2hpcCBmcm9tIFwiLi9yZWxhdGlvbnNoaXBzL2JlbG9uZ3MtdG8uanNcIlxuaW1wb3J0IENvbmZpZ3VyYXRpb24gZnJvbSBcIi4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIlxuaW1wb3J0IEN1cnJlbnQgZnJvbSBcIi4uLy4uL2N1cnJlbnQuanNcIlxuaW1wb3J0IEZyb21UYWJsZSBmcm9tIFwiLi4vcXVlcnkvZnJvbS10YWJsZS5qc1wiXG5pbXBvcnQgSGFuZGxlciBmcm9tIFwiLi4vaGFuZGxlci5qc1wiXG5pbXBvcnQgSGFzTWFueUluc3RhbmNlUmVsYXRpb25zaGlwIGZyb20gXCIuL2luc3RhbmNlLXJlbGF0aW9uc2hpcHMvaGFzLW1hbnkuanNcIlxuaW1wb3J0IEhhc01hbnlSZWxhdGlvbnNoaXAgZnJvbSBcIi4vcmVsYXRpb25zaGlwcy9oYXMtbWFueS5qc1wiXG5pbXBvcnQgSGFzT25lSW5zdGFuY2VSZWxhdGlvbnNoaXAgZnJvbSBcIi4vaW5zdGFuY2UtcmVsYXRpb25zaGlwcy9oYXMtb25lLmpzXCJcbmltcG9ydCBIYXNPbmVSZWxhdGlvbnNoaXAgZnJvbSBcIi4vcmVsYXRpb25zaGlwcy9oYXMtb25lLmpzXCJcbmltcG9ydCBSZWNvcmRBdHRhY2htZW50SGFuZGxlIGZyb20gXCIuL2F0dGFjaG1lbnRzL2hhbmRsZS5qc1wiXG5pbXBvcnQgKiBhcyBpbmZsZWN0aW9uIGZyb20gXCJpbmZsZWN0aW9uXCJcbmltcG9ydCBkZWJ1cnJDb2x1bW5OYW1lIGZyb20gXCIuLi8uLi91dGlscy9kZWJ1cnItY29sdW1uLW5hbWUuanNcIlxuaW1wb3J0IE1vZGVsQ2xhc3NRdWVyeSBmcm9tIFwiLi4vcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIlxuaW1wb3J0IFByZWxvYWRlciBmcm9tIFwiLi4vcXVlcnkvcHJlbG9hZGVyLmpzXCJcbmltcG9ydCB7cmVhZFBheWxvYWRBc3NvY2lhdGlvbkNvdW50LCByZWFkUGF5bG9hZENvbXB1dGVkQWJpbGl0eSwgcmVhZFBheWxvYWRRdWVyeURhdGEsIHNldFBheWxvYWRBc3NvY2lhdGlvbkNvdW50LCBzZXRQYXlsb2FkQ29tcHV0ZWRBYmlsaXR5LCBzZXRQYXlsb2FkUXVlcnlEYXRhfSBmcm9tIFwiLi4vLi4vcmVjb3JkLXBheWxvYWQtdmFsdWVzLmpzXCJcbmltcG9ydCByZWNvcmRDaGFuZ2VzIGZyb20gXCIuLi9yZWNvcmQtY2hhbmdlcy5qc1wiXG5pbXBvcnQgcmVzdEFyZ3NFcnJvciBmcm9tIFwiLi4vLi4vdXRpbHMvcmVzdC1hcmdzLWVycm9yLmpzXCJcbmltcG9ydCBzaW5ndWxhcml6ZU1vZGVsTmFtZSBmcm9tIFwiLi4vLi4vdXRpbHMvc2luZ3VsYXJpemUtbW9kZWwtbmFtZS5qc1wiXG5pbXBvcnQge2RlZmluZU1vZGVsU2NvcGV9IGZyb20gXCIuLi8uLi91dGlscy9tb2RlbC1zY29wZS5qc1wiXG5pbXBvcnQgeyBub3JtYWxpemVEYXRlU3RyaW5nRm9yV3JpdGUsIG5vcm1hbGl6ZURhdGVWYWx1ZUZvclJlYWQsIG5vcm1hbGl6ZURhdGVWYWx1ZUZvcldyaXRlIH0gZnJvbSBcIi4uL2RhdGV0aW1lLXN0b3JhZ2UuanNcIlxuaW1wb3J0IHtmb3JtYXRWYWx1ZX0gZnJvbSBcIi4uLy4uL3V0aWxzL2Zvcm1hdC12YWx1ZS5qc1wiXG5pbXBvcnQge2NhcHR1cmVDcmVhdGVBdWRpdENoYW5nZXMsIGNhcHR1cmVVcGRhdGVBdWRpdENoYW5nZXMsIGNyZWF0ZUF1ZGl0LCBjcmVhdGVDcmVhdGVBdWRpdCwgY3JlYXRlRGVzdHJveUF1ZGl0LCBjcmVhdGVVcGRhdGVBdWRpdCwgaW5pdGlhbGl6ZUF1ZGl0aW5nLCByZWdpc3RlckF1ZGl0Q2FsbGJhY2ssIHJlZ2lzdGVyQXVkaXRpbmcsIHdpdGhvdXRBdWRpdH0gZnJvbSBcIi4vYXVkaXRpbmcuanNcIlxuaW1wb3J0IHtyZWdpc3Rlck1hZ25pdHVkZUNvdW50ZXJDYWNoZX0gZnJvbSBcIi4vY291bnRlci1jYWNoZS1tYWduaXR1ZGUuanNcIlxuaW1wb3J0IHtzdGF0ZU1hY2hpbmV9IGZyb20gXCIuL3N0YXRlLW1hY2hpbmUuanNcIlxuaW1wb3J0IFZhbGlkYXRvcnNGb3JtYXQgZnJvbSBcIi4vdmFsaWRhdG9ycy9mb3JtYXQuanNcIlxuaW1wb3J0IFZhbGlkYXRvcnNMZW5ndGggZnJvbSBcIi4vdmFsaWRhdG9ycy9sZW5ndGguanNcIlxuaW1wb3J0IFZhbGlkYXRvcnNQcmVzZW5jZSBmcm9tIFwiLi92YWxpZGF0b3JzL3ByZXNlbmNlLmpzXCJcbmltcG9ydCBWYWxpZGF0b3JzVW5pcXVlbmVzcyBmcm9tIFwiLi92YWxpZGF0b3JzL3VuaXF1ZW5lc3MuanNcIlxuaW1wb3J0IHJlZ2lzdGVyQWN0c0FzTGlzdENhbGxiYWNrcyBmcm9tIFwiLi9hY3RzLWFzLWxpc3QuanNcIlxuaW1wb3J0IFRlbmFudE1vZGVsU2NvcGUgZnJvbSBcIi4uLy4uL3RlbmFudHMvdGVuYW50LW1vZGVsLXNjb3BlLmpzXCJcbmltcG9ydCBVVUlEIGZyb20gXCJwdXJlLXV1aWRcIlxuXG4vKipcbiAqIFRyYW5zbGF0aW9uIHJlY29yZCBzaGFwZSB1c2VkIGJ5IHRyYW5zbGF0ZWQgYXR0cmlidXRlcy5cbiAqIEB0eXBlZGVmIHtWZWxvY2lvdXNEYXRhYmFzZVJlY29yZCAmIHtsb2NhbGU6ICgpID0+IHN0cmluZ319IFRyYW5zbGF0aW9uQmFzZVxuICovXG4vKipcbiAqIEF0dGFjaG1lbnREcml2ZXJDb25zdHJ1Y3RvciB0eXBlLlxuICogQHR5cGVkZWYge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQXR0YWNobWVudERyaXZlckNvbnN0cnVjdG9yfSBBdHRhY2htZW50RHJpdmVyQ29uc3RydWN0b3JcbiAqL1xuLyoqIEB0eXBlZGVmIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLkF0dGFjaG1lbnRTeW5jQ29uZmlndXJhdGlvbn0gQXR0YWNobWVudFN5bmNDb25maWd1cmF0aW9uICovXG4vKiogQHR5cGVkZWYge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuUmVjb3JkQXR0YWNobWVudENvbmZpZ3VyYXRpb259IFJlY29yZEF0dGFjaG1lbnRDb25maWd1cmF0aW9uICovXG5cbi8qKiBTdG9yZWQgdmFsdWVzIHRoYXQgYSBkZWNsYXJlZCBgXCJib29sZWFuXCJgIGNhc3QgcmVhZHMgYmFjayBhcyBgdHJ1ZWAuICovXG5jb25zdCBkZWNsYXJlZEJvb2xlYW5UcnV0aHlWYWx1ZXMgPSBuZXcgU2V0KFsxLCB0cnVlLCBcIjFcIl0pXG5cbi8qKiBTdG9yZWQgdmFsdWVzIHRoYXQgYSBkZWNsYXJlZCBgXCJib29sZWFuXCJgIGNhc3QgcmVhZHMgYmFjayBhcyBgZmFsc2VgLiAqL1xuY29uc3QgZGVjbGFyZWRCb29sZWFuRmFsc3lWYWx1ZXMgPSBuZXcgU2V0KFswLCBmYWxzZSwgXCIwXCJdKVxuXG4vKiogU3RhdGljIHJlY29yZCBtZXRhZGF0YSBmaWVsZHMgaXNvbGF0ZWQgcGVyIHBoeXNpY2FsIGRhdGFiYXNlL3NjaGVtYSBnZW5lcmF0aW9uLiAqL1xuY29uc3QgcmVjb3JkTWV0YWRhdGFQcm9wZXJ0eU5hbWVzID0gbmV3IFNldChbXG4gIFwiX2F0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVcIixcbiAgXCJfY29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZVwiLFxuICBcIl9jb2x1bW5OYW1lc1wiLFxuICBcIl9jb2x1bW5zXCIsXG4gIFwiX2NvbHVtbnNBc0hhc2hcIixcbiAgXCJfY29sdW1uVHlwZUJ5TmFtZVwiLFxuICBcIl9kYXRhYmFzZVR5cGVcIixcbiAgXCJfaW5pdGlhbGl6ZWRcIixcbiAgXCJfaW5pdGlhbGl6ZVJlY29yZFByb21pc2VcIixcbiAgXCJfdGFibGVcIlxuXSlcblxuLyoqIEB0eXBlIHtXZWFrTWFwPHR5cGVvZiBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHQsIE1hcDxzdHJpbmcsIE1hcDxzdHJpbmcsIFJlY29yZE1ldGFkYXRhVmFsdWU+Pj59ICovXG5jb25zdCByZWNvcmRNZXRhZGF0YVZhbHVlc0J5TW9kZWwgPSBuZXcgV2Vha01hcCgpXG5cbi8qKlxuICogUmV0dXJucyB0aGUgZ2VuZXJhdGlvbi1rZXllZCBtZXRhZGF0YSBzdG9yZSBvd25lZCBieSBvbmUgY2Fub25pY2FsIG1vZGVsLlxuICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gQ2Fub25pY2FsIG1vZGVsIGNsYXNzLlxuICogQHJldHVybnMge01hcDxzdHJpbmcsIE1hcDxzdHJpbmcsIFJlY29yZE1ldGFkYXRhVmFsdWU+Pn0gLSBNZXRhZGF0YSBzdG9yZS5cbiAqL1xuZnVuY3Rpb24gcmVjb3JkTWV0YWRhdGFWYWx1ZXNGb3IobW9kZWxDbGFzcykge1xuICBsZXQgdmFsdWVzID0gcmVjb3JkTWV0YWRhdGFWYWx1ZXNCeU1vZGVsLmdldChtb2RlbENsYXNzKVxuXG4gIGlmICghdmFsdWVzKSB7XG4gICAgdmFsdWVzID0gbmV3IE1hcCgpXG4gICAgcmVjb3JkTWV0YWRhdGFWYWx1ZXNCeU1vZGVsLnNldChtb2RlbENsYXNzLCB2YWx1ZXMpXG4gIH1cblxuICByZXR1cm4gdmFsdWVzXG59XG5cbmNsYXNzIFZhbGlkYXRpb25FcnJvciBleHRlbmRzIEVycm9yIHtcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IHVuZGVmaW5lZH0gLSBWZWxvY2lvdXMgbWV0YWRhdGEgZm9yIGZyb250ZW5kLW1vZGVsIGVycm9yIHJlcG9ydGluZy5cbiAgICovXG4gIHZlbG9jaW91c1xuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBtb2RlbC5cbiAgICogQHJldHVybnMge1ZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSAtIFRoZSBtb2RlbC5cbiAgICovXG4gIGdldE1vZGVsKCkge1xuICAgIGlmICghdGhpcy5fbW9kZWwpIHRocm93IG5ldyBFcnJvcihcIk1vZGVsIGhhc24ndCBiZWVuIHNldFwiKVxuXG4gICAgcmV0dXJuIHRoaXMuX21vZGVsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgbW9kZWwuXG4gICAqIEBwYXJhbSB7VmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IG1vZGVsIC0gTW9kZWwgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldE1vZGVsKG1vZGVsKSB7XG4gICAgdGhpcy5fbW9kZWwgPSBtb2RlbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHZhbGlkYXRpb24gZXJyb3JzLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgVmFsaWRhdGlvbkVycm9yT2JqZWN0VHlwZVtdPn0gLSBUaGUgdmFsaWRhdGlvbiBlcnJvcnMuXG4gICAqL1xuICBnZXRWYWxpZGF0aW9uRXJyb3JzKCkge1xuICAgIGlmICghdGhpcy5fdmFsaWRhdGlvbkVycm9ycykgdGhyb3cgbmV3IEVycm9yKFwiVmFsaWRhdGlvbiBlcnJvcnMgaGFzbid0IGJlZW4gc2V0XCIpXG5cbiAgICByZXR1cm4gdGhpcy5fdmFsaWRhdGlvbkVycm9yc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHZhbGlkYXRpb24gZXJyb3JzLlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFZhbGlkYXRpb25FcnJvck9iamVjdFR5cGVbXT59IHZhbGlkYXRpb25FcnJvcnMgLSBWYWxpZGF0aW9uIGVycm9ycyB0byBhc3NpZ24uXG4gICAqL1xuICBzZXRWYWxpZGF0aW9uRXJyb3JzKHZhbGlkYXRpb25FcnJvcnMpIHtcbiAgICB0aGlzLl92YWxpZGF0aW9uRXJyb3JzID0gdmFsaWRhdGlvbkVycm9yc1xuICB9XG59XG5cbi8qKlxuICogUnVucyBhcHBseSBidWlsdCByZWNvcmQgaW52ZXJzZSByZWxhdGlvbnNoaXAuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMuXG4gKiBAcGFyYW0ge1ZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBhcmdzLnBhcmVudCAtIFBhcmVudCByZWNvcmQgYmVpbmcgYnVpbHQgZnJvbS5cbiAqIEBwYXJhbSB7e2dldFJlbGF0aW9uc2hpcEJ5TmFtZTogVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmRbXCJnZXRSZWxhdGlvbnNoaXBCeU5hbWVcIl19fSBhcmdzLnJlY29yZCAtIE5ld2x5IGJ1aWx0IHJlbGF0ZWQgcmVjb3JkLlxuICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWQgfCBudWxsfSBhcmdzLmludmVyc2VPZiAtIEludmVyc2UgcmVsYXRpb25zaGlwIG5hbWUuXG4gKiBAcGFyYW0ge2Jvb2xlYW59IGFyZ3MuYWxsb3dIYXNNYW55IC0gV2hldGhlciBhIGhhcy1tYW55IGludmVyc2Ugc2hvdWxkIGJlIGFwcGVuZGVkLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGFwcGx5QnVpbHRSZWNvcmRJbnZlcnNlUmVsYXRpb25zaGlwKHthbGxvd0hhc01hbnksIGludmVyc2VPZiwgcGFyZW50LCByZWNvcmR9KSB7XG4gIGlmICghaW52ZXJzZU9mKSByZXR1cm5cblxuICBjb25zdCBpbnZlcnNlSW5zdGFuY2VSZWxhdGlvbnNoaXAgPSByZWNvcmQuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKGludmVyc2VPZilcblxuICBpbnZlcnNlSW5zdGFuY2VSZWxhdGlvbnNoaXAuc2V0QXV0b1NhdmUoZmFsc2UpXG5cbiAgaWYgKCFhbGxvd0hhc01hbnkgfHwgaW52ZXJzZUluc3RhbmNlUmVsYXRpb25zaGlwLmdldFR5cGUoKSA9PSBcImhhc09uZVwiKSB7XG4gICAgaW52ZXJzZUluc3RhbmNlUmVsYXRpb25zaGlwLnNldExvYWRlZChwYXJlbnQpXG4gICAgcmV0dXJuXG4gIH1cblxuICBpZiAoaW52ZXJzZUluc3RhbmNlUmVsYXRpb25zaGlwLmdldFR5cGUoKSA9PSBcImhhc01hbnlcIikge1xuICAgIGludmVyc2VJbnN0YW5jZVJlbGF0aW9uc2hpcC5hZGRUb0xvYWRlZChwYXJlbnQpXG4gICAgcmV0dXJuXG4gIH1cblxuICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gcmVsYXRpb25zaGlwIHR5cGU6ICR7aW52ZXJzZUluc3RhbmNlUmVsYXRpb25zaGlwLmdldFR5cGUoKX1gKVxufVxuXG4vKipcbiAqIEJ1aWxkIGEgcmVsYXRlZCByZWNvcmQgYW5kIHdpcmUgaXRzIGludmVyc2UgcmVsYXRpb25zaGlwIHRvIHRoZSBwYXJlbnQuXG4gKiBAcGFyYW0ge1ZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBwYXJlbnQgLSBQYXJlbnQgcmVjb3JkIGJ1aWxkaW5nIHRoZSByZWxhdGlvbnNoaXAuXG4gKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lIGJlaW5nIGJ1aWx0LlxuICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGF0dHJpYnV0ZXMgLSBBdHRyaWJ1dGVzIGZvciB0aGUgbmV3IHJlbGF0ZWQgcmVjb3JkLlxuICogQHBhcmFtIHtib29sZWFufSBhbGxvd0hhc01hbnkgLSBXaGV0aGVyIGhhcy1tYW55IGludmVyc2UgcmVsYXRpb25zaGlwcyBzaG91bGQgYXBwZW5kIHRoZSBwYXJlbnQuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIEJ1aWx0IHJlbGF0ZWQgcmVjb3JkLlxuICovXG5mdW5jdGlvbiBidWlsZFJlbGF0ZWRSZWNvcmRXaXRoSW52ZXJzZShwYXJlbnQsIHJlbGF0aW9uc2hpcE5hbWUsIGF0dHJpYnV0ZXMsIGFsbG93SGFzTWFueSkge1xuICBjb25zdCBpbnN0YW5jZVJlbGF0aW9uc2hpcCA9IHBhcmVudC5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcbiAgY29uc3QgcmVjb3JkID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAuYnVpbGQoYXR0cmlidXRlcylcbiAgY29uc3QgaW52ZXJzZU9mID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0UmVsYXRpb25zaGlwKCkuZ2V0SW52ZXJzZU9mKClcblxuICBhcHBseUJ1aWx0UmVjb3JkSW52ZXJzZVJlbGF0aW9uc2hpcCh7XG4gICAgYWxsb3dIYXNNYW55LFxuICAgIGludmVyc2VPZixcbiAgICBwYXJlbnQsXG4gICAgcmVjb3JkOiAvKiogQHR5cGUge3tnZXRSZWxhdGlvbnNoaXBCeU5hbWU6IFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkW1wiZ2V0UmVsYXRpb25zaGlwQnlOYW1lXCJdfX0gKi8gKHJlY29yZClcbiAgfSlcblxuICByZXR1cm4gcmVjb3JkXG59XG5cbmNsYXNzIFRlbmFudERhdGFiYXNlU2NvcGVFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gRXJyb3IgbWVzc2FnZS5cbiAgICogQHBhcmFtIHt7bW9kZWxOYW1lOiBzdHJpbmd9fSBhcmdzIC0gQ29udGV4dCBmb3IgdGhlIGZhaWxlZCB0ZW5hbnQtc2NvcGVkIG1vZGVsLlxuICAgKi9cbiAgY29uc3RydWN0b3IobWVzc2FnZSwge21vZGVsTmFtZX0pIHtcbiAgICBzdXBlcihtZXNzYWdlKVxuICAgIHRoaXMubmFtZSA9IFwiVGVuYW50RGF0YWJhc2VTY29wZUVycm9yXCJcbiAgICB0aGlzLm1vZGVsTmFtZSA9IG1vZGVsTmFtZVxuICB9XG59XG5cbi8qKlxuICogQmFzZSBkYXRhYmFzZSByZWNvcmQuXG4gKiBAdGVtcGxhdGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gW1dyaXRlQXR0cmlidXRlcz1SZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj5dXG4gKi9cbmNsYXNzIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkIHtcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgX2F0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWUgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgX2NvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWUgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBvYmplY3Q+IHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgX3RyYW5zbGF0aW9ucyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vdmFsaWRhdG9ycy9iYXNlLmpzXCIpLmRlZmF1bHRbXT4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBfdmFsaWRhdG9ycyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIExpZmVjeWNsZUNhbGxiYWNrVHlwZVtdPiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIF9saWZlY3ljbGVDYWxsYmFja3MgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB0eXBlb2YgaW1wb3J0KFwiLi92YWxpZGF0b3JzL2Jhc2UuanNcIikuZGVmYXVsdD4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBfdmFsaWRhdG9yVHlwZXMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZWNvcmRBdHRhY2htZW50Q29uZmlndXJhdGlvbj4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBfYXR0YWNobWVudHNNYXAgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3JlbGF0aW9uc2hpcHMvYmFzZS5qc1wiKS5kZWZhdWx0PiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIF9yZWxhdGlvbnNoaXBzID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vcXVlcnkvcXVlcnktZGF0YS5qc1wiKS5RdWVyeURhdGFGbj4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBfcXVlcnlEYXRhUmVnaXN0cmF0aW9ucyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIHthbGxvd0Rlc3Ryb3k/OiBib29sZWFuLCBsaW1pdD86IG51bWJlciwgcmVqZWN0SWY/OiAoYXR0cmlidXRlczogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBib29sZWFufT4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBfYWNjZXB0ZWROZXN0ZWRBdHRyaWJ1dGVzID0gdW5kZWZpbmVkXG4gIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIF9hdHRyaWJ1dGVDYXN0cyA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS1jb2x1bW4uanNcIikuZGVmYXVsdD4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBfY29sdW1uc0FzSGFzaCA9IHVuZGVmaW5lZFxuICAvKiogQHR5cGUge0FycmF5PHN0cmluZz4gfCB1bmRlZmluZWR9ICovXG4gIHN0YXRpYyBfY29sdW1uTmFtZXMgPSB1bmRlZmluZWRcbiAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgX2NvbHVtblR5cGVCeU5hbWUgPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgKiBAdHlwZSB7c3RyaW5nIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgbW9kZWxOYW1lXG5cbiAgLyoqXG4gICAqIE9wdC1pbiBjbGllbnQgc3luYyBkZWNsYXJhdGlvbiBjb25zdW1lZCBieSBgU3luY0NsaWVudC5mcm9tQ29uZmlndXJhdGlvbiguLi4pYC5cbiAgICogRGVjbGFyZSBgc3RhdGljIHN5bmMgPSB0cnVlYCAoYWxsIGRlZmF1bHRzKSBvciBhIGRlY2xhcmF0aW9uIG9iamVjdCBsaWtlXG4gICAqIGBzdGF0aWMgc3luYyA9IHt0cmFjazogW1wiY3JlYXRlXCIsIFwidXBkYXRlXCJdLCBzeW5jVHlwZTogXCJ1cHNlcnRcIn1gIHRvIGhhdmUgdGhlXG4gICAqIHN5bmMgY2xpZW50IGF1dG8tZGlzY292ZXIgdGhpcyBtb2RlbCBhbmQgZGVyaXZlIGl0cyByZXNvdXJjZSBjb25maWcgZnJvbVxuICAgKiBjb2x1bW4gbWV0YWRhdGEuXG4gICAqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9zeW5jL3N5bmMtY2xpZW50LXR5cGVzLmpzXCIpLk1vZGVsU3luY0RlY2xhcmF0aW9uIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgc3luY1xuXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtQcm9taXNlPHZvaWQ+IHwgbnVsbCB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIF9pbml0aWFsaXplUmVjb3JkUHJvbWlzZVxuXG4gIC8qKiBAdHlwZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkIHwgdW5kZWZpbmVkfSBDYW5vbmljYWwgbW9kZWwgY2xhc3MgZXhwb3NlZCBvbmx5IGJ5IGFuIG9wZXJhdGlvbi1ib3VuZCBtZXRhZGF0YSBwcm94eS4gKi9cbiAgc3RhdGljIF9yZWNvcmRNZXRhZGF0YU1vZGVsQ2xhc3NcblxuICAvKiogQHR5cGUgeygobW9kZWxDbGFzczogdHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkKSA9PiB0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQpIHwgdW5kZWZpbmVkfSBCaW5kcyByZWxhdGVkIGdlbmVyYXRlZCBtb2RlbCBjbGFzc2VzIHRvIHRoZSBzYW1lIG9wZXJhdGlvbiBtZXRhZGF0YSBnZW5lcmF0aW9uLiAqL1xuICBzdGF0aWMgX3JlY29yZE1ldGFkYXRhQmluZGVyXG5cbiAgLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9vcGVyYXRpb24uanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gT3BlcmF0aW9uIGV4cG9zZWQgb25seSBieSBhIGNvbnN0cnVjdGluZyBtZXRhZGF0YSBwcm94eS4gKi9cbiAgc3RhdGljIF9yZWNvcmRNZXRhZGF0YU9wZXJhdGlvblxuXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtib29sZWFuIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgX2VhZ2VyTG9hZFJlY29yZE1ldGFkYXRhXG5cbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vYXVkaXRpbmcuanNcIikuQXVkaXRDYWxsYmFja1tdPiB8IHVuZGVmaW5lZH0gKi9cbiAgc3RhdGljIF9hdWRpdENhbGxiYWNrc1xuXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtib29sZWFuIHwgdW5kZWZpbmVkfSAqL1xuICBzdGF0aWMgX2F1ZGl0TGlmZWN5Y2xlQ2FsbGJhY2tzUmVnaXN0ZXJlZFxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBtb2RlbCBuYW1lLCBwcmVmZXJyaW5nIGFuIGV4cGxpY2l0IGBzdGF0aWMgbW9kZWxOYW1lYCBkZWNsYXJhdGlvblxuICAgKiBvdmVyIHRoZSBKYXZhU2NyaXB0IGNsYXNzIGAubmFtZWAgcHJvcGVydHkuIFRoaXMgYWxsb3dzIG1pbmlmaWVkIGJ1aWxkcyB0b1xuICAgKiBwcmVzZXJ2ZSBjb3JyZWN0IG1vZGVsIG5hbWVzIHdpdGhvdXQgcmVseWluZyBvbiBga2VlcF9jbGFzc25hbWVzYC5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgbW9kZWwgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBnZXRNb2RlbE5hbWUoKSB7XG4gICAgaWYgKHR5cGVvZiB0aGlzLm1vZGVsTmFtZSA9PT0gXCJzdHJpbmdcIiAmJiB0aGlzLm1vZGVsTmFtZS5sZW5ndGggPiAwKSByZXR1cm4gdGhpcy5tb2RlbE5hbWVcblxuICAgIHJldHVybiB0aGlzLm5hbWVcbiAgfVxuXG4gIHN0YXRpYyBnZXRBdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwKCkge1xuICAgIGlmICghdGhpcy5fYXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZSkge1xuICAgICAgLyoqXG4gICAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gKi9cbiAgICAgIHRoaXMuX2F0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWUgPSB7fVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9hdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgdGhlIGRhdGFiYXNlIGNvbHVtbiBuYW1lIGZvciBhIHJlY29yZCBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZSB0byByZXNvbHZlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIE1hcHBlZCBjb2x1bW4gbmFtZSwgb3IgdGhlIHVuZGVyc2NvcmVkIGF0dHJpYnV0ZSBuYW1lIHdoZW4gbm8gbWFwcGluZyBleGlzdHMuXG4gICAqL1xuICBzdGF0aWMgZ2V0Q29sdW1uTmFtZUZvckF0dHJpYnV0ZU5hbWUoYXR0cmlidXRlTmFtZSkge1xuICAgIGNvbnN0IHJlc29sdmVkQXR0cmlidXRlTmFtZSA9IHRoaXMucmVzb2x2ZUF0dHJpYnV0ZU5hbWUoYXR0cmlidXRlTmFtZSlcblxuICAgIGlmIChyZXNvbHZlZEF0dHJpYnV0ZU5hbWUpIHJldHVybiB0aGlzLmdldEF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXAoKVtyZXNvbHZlZEF0dHJpYnV0ZU5hbWVdXG5cbiAgICByZXR1cm4gaW5mbGVjdGlvbi51bmRlcnNjb3JlKGluZmxlY3Rpb24uY2FtZWxpemUoZGVidXJyQ29sdW1uTmFtZShhdHRyaWJ1dGVOYW1lKSwgdHJ1ZSkpXG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZXMgYW4gaW5jb21pbmcgYXR0cmlidXRlIG9yIGNvbHVtbiBuYW1lIHRvIHRoZSBjYW5vbmljYWwgYXR0cmlidXRlIG5hbWUgdGhpcyBtb2RlbCBleHBvc2VzLlxuICAgKiBBY2NlcHRzIHRoZSBjYW5vbmljYWwgKGRlYnVycmVkKSBhdHRyaWJ1dGUgbmFtZSwgYSByYXcgdW1sYXV0L2Fjcm9ueW0gY29sdW1uIG5hbWUsIGEgcHJlLWRlYnVyclxuICAgKiBjYW1lbGl6YXRpb24sIGFuZCBjYW1lbENhc2UgY2FzaW5nIHZhcmlhbnRzIChlLmcuIFwidkFGdW5rdGlvbklEXCIgdnMgXCJ2QUZ1bmt0aW9uaWRcIikuIFJldHVybnMgbnVsbFxuICAgKiB3aGVuIG5vdGhpbmcgbWF0Y2hlcywgc28gY2FsbGVycyBrZWVwIHRoZWlyIG93biBub3QtZm91bmQgaGFuZGxpbmcuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gQXR0cmlidXRlIG5hbWUgb3IgY29sdW1uIG5hbWUgdG8gcmVzb2x2ZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gQ2Fub25pY2FsIGF0dHJpYnV0ZSBuYW1lLCBvciBudWxsLlxuICAgKi9cbiAgc3RhdGljIHJlc29sdmVBdHRyaWJ1dGVOYW1lKG5hbWUpIHtcbiAgICBjb25zdCBhdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwID0gdGhpcy5nZXRBdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwKClcblxuICAgIGlmIChuYW1lIGluIGF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXApIHJldHVybiBuYW1lXG5cbiAgICBjb25zdCBub3JtYWxpemVkQXR0cmlidXRlTmFtZSA9IGluZmxlY3Rpb24uY2FtZWxpemUoZGVidXJyQ29sdW1uTmFtZShuYW1lKSwgdHJ1ZSlcblxuICAgIGlmIChub3JtYWxpemVkQXR0cmlidXRlTmFtZSBpbiBhdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwKSByZXR1cm4gbm9ybWFsaXplZEF0dHJpYnV0ZU5hbWVcblxuICAgIGNvbnN0IGNvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXAgPSB0aGlzLmdldENvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXAoKVxuXG4gICAgaWYgKG5hbWUgaW4gY29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCkgcmV0dXJuIGNvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXBbbmFtZV1cblxuICAgIC8vIEZpbmFsIGZhbGxiYWNrOiBtYXRjaCBjYW1lbENhc2UgY2FzaW5nIHZhcmlhbnRzIGFnYWluc3QgdGhlIG1vZGVsJ3MgZ2VuZXJhdGVkIGFjY2Vzc29ycy4gVGhlc2VcbiAgICAvLyBleGlzdCBvbiB0aGUgcHJvdG90eXBlIGJlZm9yZSBydW50aW1lIGluaXRpYWxpemF0aW9uICh1bmxpa2UgdGhlIGF0dHJpYnV0ZSBtYXApLCBzbyB0aGlzIGFsc29cbiAgICAvLyByZXNvbHZlcyBuYW1lcyBsb29rZWQgdXAgZHVyaW5nIGNyZWF0ZSwgYmVmb3JlIHRoZSBtYXAgaXMgYnVpbHQuIGluZmxlY3Rpb24gbG93ZXItY2FzZXMgdHJhaWxpbmdcbiAgICAvLyBhY3JvbnltcyAoXCJJRFwiIC0+IFwiaWRcIiksIHNvIFwidkFGdW5rdGlvbklEXCIvXCJWQV9GdW5rdGlvbklEXCIgc3RpbGwgcmVzb2x2ZSB0byBcInZBRnVua3Rpb25pZFwiLlxuICAgIGNvbnN0IGxvd2VyTm9ybWFsaXplZEF0dHJpYnV0ZU5hbWUgPSBub3JtYWxpemVkQXR0cmlidXRlTmFtZS50b0xvd2VyQ2FzZSgpXG4gICAgbGV0IHByb3RvdHlwZSA9IHRoaXMucHJvdG90eXBlXG5cbiAgICB3aGlsZSAocHJvdG90eXBlICYmIHByb3RvdHlwZSAhPT0gT2JqZWN0LnByb3RvdHlwZSkge1xuICAgICAgZm9yIChjb25zdCBhY2Nlc3Nvck5hbWUgb2YgT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMocHJvdG90eXBlKSkge1xuICAgICAgICBpZiAoYWNjZXNzb3JOYW1lLnRvTG93ZXJDYXNlKCkgPT09IGxvd2VyTm9ybWFsaXplZEF0dHJpYnV0ZU5hbWUpIHJldHVybiBhY2Nlc3Nvck5hbWVcbiAgICAgIH1cblxuICAgICAgcHJvdG90eXBlID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKHByb3RvdHlwZSlcbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIEZpbmRzIHRoZSBtZW1iZXIgbmFtZSBvbiBhIHRhcmdldCdzIHByb3RvdHlwZSBjaGFpbiBtYXRjaGluZyBgbWVtYmVyTmFtZWAsIGZhbGxpbmcgYmFjayB0byBhXG4gICAqIGNhc2UtaW5zZW5zaXRpdmUgbWF0Y2guIFJlc29sdmVzIHNldHRlcnMgd2hlbiBhIHJlYWQtb25seSBhdHRyaWJ1dGUgYWxpYXMgZGlmZmVycyBvbmx5IGluIGNhbWVsQ2FzZVxuICAgKiBjYXNpbmcgZnJvbSB0aGUgZ2VuZXJhdGVkIGFjY2Vzc29yIChlLmcuIGEgXCJ2QUZ1bmt0aW9uSURcIiBhbGlhcyB3aG9zZSBzZXR0ZXIgaXMgXCJzZXRWQUZ1bmt0aW9uaWRcIikuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSB0YXJnZXQgLSBJbnN0YW5jZSBvciBwcm90b3R5cGUgdG8gc2VhcmNoLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWVtYmVyTmFtZSAtIE1lbWJlciBuYW1lIHRvIGZpbmQuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBudWxsfSAtIE1hdGNoaW5nIG1lbWJlciBuYW1lLCBvciBudWxsIHdoZW4gYWJzZW50LlxuICAgKi9cbiAgc3RhdGljIGZpbmRNZW1iZXJOYW1lSW5zZW5zaXRpdmUodGFyZ2V0LCBtZW1iZXJOYW1lKSB7XG4gICAgaWYgKG1lbWJlck5hbWUgaW4gdGFyZ2V0KSByZXR1cm4gbWVtYmVyTmFtZVxuXG4gICAgY29uc3QgbG93ZXJNZW1iZXJOYW1lID0gbWVtYmVyTmFtZS50b0xvd2VyQ2FzZSgpXG4gICAgbGV0IGN1cnJlbnQgPSB0YXJnZXRcblxuICAgIHdoaWxlIChjdXJyZW50ICYmIGN1cnJlbnQgIT09IE9iamVjdC5wcm90b3R5cGUpIHtcbiAgICAgIGZvciAoY29uc3QgY2FuZGlkYXRlTmFtZSBvZiBPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyhjdXJyZW50KSkge1xuICAgICAgICBpZiAoY2FuZGlkYXRlTmFtZS50b0xvd2VyQ2FzZSgpID09PSBsb3dlck1lbWJlck5hbWUpIHJldHVybiBjYW5kaWRhdGVOYW1lXG4gICAgICB9XG5cbiAgICAgIGN1cnJlbnQgPSBPYmplY3QuZ2V0UHJvdG90eXBlT2YoY3VycmVudClcbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVmaW5lIHNjb3BlLlxuICAgKiBAcGFyYW0geyguLi5hcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBjYWxsYmFjayAtIFNjb3BlIGNhbGxiYWNrLlxuICAgKiBAcmV0dXJucyB7KCguLi5hcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IGltcG9ydChcIi4uL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkPikgJiB7c2NvcGU6ICguLi5hcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IGltcG9ydChcIi4uLy4uL3V0aWxzL21vZGVsLXNjb3BlLmpzXCIpLk1vZGVsU2NvcGVEZXNjcmlwdG9yfX0gLSBTY29wZSBoZWxwZXIuXG4gICAqL1xuICBzdGF0aWMgZGVmaW5lU2NvcGUoY2FsbGJhY2spIHtcbiAgICByZXR1cm4gZGVmaW5lTW9kZWxTY29wZSh7XG4gICAgICBjYWxsYmFjayxcbiAgICAgIG1vZGVsQ2xhc3M6IHRoaXMsXG4gICAgICBzdGFydFF1ZXJ5OiAobW9kZWxDbGFzcyA9IHRoaXMpID0+IHtcbiAgICAgICAgLy8gVGhpcyBiYWNrZW5kIHNjb3BlIGZhY3RvcnkgY2FuIG9ubHkgYmUgaW52b2tlZCB0aHJvdWdoIGEgRGF0YWJhc2VSZWNvcmQgY2xhc3MuXG4gICAgICAgIGNvbnN0IEJhY2tlbmRNb2RlbENsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9ICovIChtb2RlbENsYXNzKVxuXG4gICAgICAgIHJldHVybiBCYWNrZW5kTW9kZWxDbGFzcy5fbmV3UXVlcnkoKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgYXBwbGljYXRpb24gbW9kZWwgY2xhc3MgYmVoaW5kIGFuIG9wZXJhdGlvbi1ib3VuZCBtZXRhZGF0YSB2aWV3LlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSAtIENhbm9uaWNhbCBtb2RlbCBjbGFzcy5cbiAgICovXG4gIHN0YXRpYyBjYW5vbmljYWxSZWNvcmRNZXRhZGF0YU1vZGVsQ2xhc3MoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3JlY29yZE1ldGFkYXRhTW9kZWxDbGFzcyB8fCB0aGlzXG4gIH1cblxuICAvKipcbiAgICogQmluZHMgYSByZWxhdGlvbnNoaXAgdGFyZ2V0IHRvIHRoaXMgbW9kZWwgY2xhc3MncyBtZXRhZGF0YSBnZW5lcmF0aW9uLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gbW9kZWxDbGFzcyAtIFJlbGF0aW9uc2hpcCB0YXJnZXQuXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IC0gR2VuZXJhdGlvbi1ib3VuZCB0YXJnZXQsIG9yIHRoZSB1bmNoYW5nZWQgdGFyZ2V0IGZvciBsZWdhY3kgcXVlcmllcy5cbiAgICovXG4gIHN0YXRpYyBiaW5kUmVjb3JkTWV0YWRhdGFNb2RlbENsYXNzKG1vZGVsQ2xhc3MpIHtcbiAgICByZXR1cm4gdGhpcy5fcmVjb3JkTWV0YWRhdGFCaW5kZXIgPyB0aGlzLl9yZWNvcmRNZXRhZGF0YUJpbmRlcihtb2RlbENsYXNzKSA6IG1vZGVsQ2xhc3NcbiAgfVxuXG4gIHN0YXRpYyBnZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKCkge1xuICAgIGlmICghdGhpcy5fY29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZSkge1xuICAgICAgLyoqXG4gICAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gKi9cbiAgICAgIHRoaXMuX2NvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWUgPSB7fVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9jb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lXG4gIH1cblxuICBzdGF0aWMgZ2V0VHJhbnNsYXRpb25zTWFwKCkge1xuICAgIGlmICghdGhpcy5fdHJhbnNsYXRpb25zKSB7XG4gICAgICAvKipcbiAgICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBvYmplY3Q+fSAqL1xuICAgICAgdGhpcy5fdHJhbnNsYXRpb25zID0ge31cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fdHJhbnNsYXRpb25zXG4gIH1cblxuICBzdGF0aWMgZ2V0VmFsaWRhdG9yc01hcCgpIHtcbiAgICBpZiAoIXRoaXMuX3ZhbGlkYXRvcnMpIHtcbiAgICAgIC8qKlxuICAgICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vdmFsaWRhdG9ycy9iYXNlLmpzXCIpLmRlZmF1bHRbXT59ICovXG4gICAgICB0aGlzLl92YWxpZGF0b3JzID0ge31cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fdmFsaWRhdG9yc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGxpZmVjeWNsZSBjYWxsYmFja3MgbWFwLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgTGlmZWN5Y2xlQ2FsbGJhY2tUeXBlW10+fSAtIExpZmVjeWNsZSBjYWxsYmFja3Mga2V5ZWQgYnkgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBnZXRMaWZlY3ljbGVDYWxsYmFja3NNYXAoKSB7XG4gICAgaWYgKCF0aGlzLl9saWZlY3ljbGVDYWxsYmFja3MpIHtcbiAgICAgIC8qKlxuICAgICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIExpZmVjeWNsZUNhbGxiYWNrVHlwZVtdPn0gKi9cbiAgICAgIHRoaXMuX2xpZmVjeWNsZUNhbGxiYWNrcyA9IHt9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2xpZmVjeWNsZUNhbGxiYWNrc1xuICB9XG5cbiAgc3RhdGljIGdldFZhbGlkYXRvclR5cGVzTWFwKCkge1xuICAgIGlmICghdGhpcy5fdmFsaWRhdG9yVHlwZXMpIHtcbiAgICAgIC8qKlxuICAgICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIHR5cGVvZiBpbXBvcnQoXCIuL3ZhbGlkYXRvcnMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gKi9cbiAgICAgIHRoaXMuX3ZhbGlkYXRvclR5cGVzID0ge31cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fdmFsaWRhdG9yVHlwZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBhdHRhY2htZW50cyBtYXAuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZWNvcmRBdHRhY2htZW50Q29uZmlndXJhdGlvbj59IC0gQXR0YWNobWVudCBkZWZpbml0aW9ucyBrZXllZCBieSBuYW1lLlxuICAgKi9cbiAgc3RhdGljIGdldEF0dGFjaG1lbnRzTWFwKCkge1xuICAgIGlmICghdGhpcy5fYXR0YWNobWVudHNNYXApIHtcbiAgICAgIC8qKlxuICAgICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJlY29yZEF0dGFjaG1lbnRDb25maWd1cmF0aW9uPn0gKi9cbiAgICAgIHRoaXMuX2F0dGFjaG1lbnRzTWFwID0ge31cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fYXR0YWNobWVudHNNYXBcbiAgfVxuXG4gIC8qKlxuICAgKiBBdHRyaWJ1dGVzLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICBfYXR0cmlidXRlcyA9IHt9XG5cbiAgLyoqXG4gICAqIENoYW5nZXMuXG4gICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gIF9jaGFuZ2VzID0ge31cblxuICAvKipcbiAgICogQ2hhbmdlcyBjYXB0dXJlZCBiZWZvcmUgYSBjcmVhdGUgYXVkaXQgaXMgd3JpdHRlbi5cbiAgICogQHR5cGUge2ltcG9ydChcIi4vYXVkaXRpbmcuanNcIikuQXVkaXRDaGFuZ2VzIHwgdW5kZWZpbmVkfSAqL1xuICBfcGVuZGluZ0NyZWF0ZUF1ZGl0Q2hhbmdlcyA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBDaGFuZ2VzIGNhcHR1cmVkIGJlZm9yZSBhbiB1cGRhdGUgYXVkaXQgaXMgd3JpdHRlbi5cbiAgICogQHR5cGUge2ltcG9ydChcIi4vYXVkaXRpbmcuanNcIikuQXVkaXRDaGFuZ2VzIHwgdW5kZWZpbmVkfSAqL1xuICBfcGVuZGluZ1VwZGF0ZUF1ZGl0Q2hhbmdlcyA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBBdHRyaWJ1dGUgbmFtZXMgZXhwbGljaXRseSBhc3NpZ25lZCBpbiB0aGUgY3VycmVudCB1cGRhdGUgY2FsbC5cbiAgICogQHR5cGUge1NldDxzdHJpbmc+IHwgdW5kZWZpbmVkfVxuICAgKi9cbiAgX2Fzc2lnbmVkQXR0cmlidXRlTmFtZXMgPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogQ29sdW1ucyBhcyBoYXNoLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLWNvbHVtbi5qc1wiKS5kZWZhdWx0Pn0gKi9cbiAgX2NvbHVtbnNBc0hhc2ggPSB7fVxuXG4gIC8qKlxuICAgKiBDb25uZWN0aW9uLlxuICAgKiBAdHlwZSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHQgfCB1bmRlZmluZWR9ICovXG4gIF9fY29ubmVjdGlvbiA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBFeHBsaWNpdCBvcGVyYXRpb24gb3duaW5nIHRoaXMgcmVjb3JkJ3MgZGF0YWJhc2Ugd29yay5cbiAgICogQHR5cGUge2ltcG9ydChcIi4uL29wZXJhdGlvbi5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAqL1xuICBfZGF0YWJhc2VPcGVyYXRpb24gPSB1bmRlZmluZWRcblxuICAvKipcbiAgICogSW5zdGFuY2UgcmVsYXRpb25zaGlwcy5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vaW5zdGFuY2UtcmVsYXRpb25zaGlwcy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAqL1xuICBfaW5zdGFuY2VSZWxhdGlvbnNoaXBzID0ge31cbiAgLyoqXG4gICAqIEF0dGFjaG1lbnRzLlxuICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmVjb3JkQXR0YWNobWVudEhhbmRsZT59ICovXG4gIF9hdHRhY2htZW50cyA9IHt9XG5cbiAgLyoqXG4gICAqIExvYWQgY29ob3J0LlxuICAgKiBAdHlwZSB7QXJyYXk8VmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQ+IHwgdW5kZWZpbmVkfSAtIFNoYXJlZCByZWZlcmVuY2UgdG8gc2libGluZyByZWNvcmRzIGxvYWRlZCBpbiB0aGUgc2FtZSBiYXRjaC4gVXNlZCBieSBhdXRvLXByZWxvYWQuXG4gICAqL1xuICBfbG9hZENvaG9ydCA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBUYWJsZSBuYW1lLlxuICAgKiBAdHlwZSB7c3RyaW5nIHwgdW5kZWZpbmVkfSAqL1xuICBfX3RhYmxlTmFtZSA9IHVuZGVmaW5lZFxuXG4gIC8qKlxuICAgKiBWYWxpZGF0aW9uIGVycm9ycy5cbiAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFZhbGlkYXRpb25FcnJvck9iamVjdFR5cGVbXT59ICovXG4gIF92YWxpZGF0aW9uRXJyb3JzID0ge31cblxuICBzdGF0aWMgdmFsaWRhdG9yVHlwZXMoKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0VmFsaWRhdG9yVHlwZXNNYXAoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVnaXN0ZXIgdmFsaWRhdG9yIHR5cGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTmFtZS5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi92YWxpZGF0b3JzL2Jhc2UuanNcIikuZGVmYXVsdH0gdmFsaWRhdG9yQ2xhc3MgLSBWYWxpZGF0b3IgY2xhc3MuXG4gICAqL1xuICBzdGF0aWMgcmVnaXN0ZXJWYWxpZGF0b3JUeXBlKG5hbWUsIHZhbGlkYXRvckNsYXNzKSB7XG4gICAgdGhpcy52YWxpZGF0b3JUeXBlcygpW25hbWVdID0gdmFsaWRhdG9yQ2xhc3NcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlZ2lzdGVyIGxpZmVjeWNsZSBjYWxsYmFjay5cbiAgICogQHBhcmFtIHtcImFmdGVyQ3JlYXRlXCIgfCBcImFmdGVyRGVzdHJveVwiIHwgXCJhZnRlclNhdmVcIiB8IFwiYWZ0ZXJVcGRhdGVcIiB8IFwiYmVmb3JlQ3JlYXRlXCIgfCBcImJlZm9yZURlc3Ryb3lcIiB8IFwiYmVmb3JlU2F2ZVwiIHwgXCJiZWZvcmVVcGRhdGVcIiB8IFwiYmVmb3JlVmFsaWRhdGlvblwifSBjYWxsYmFja05hbWUgLSBDYWxsYmFjayB0eXBlLlxuICAgKiBAcGFyYW0ge0xpZmVjeWNsZUNhbGxiYWNrVHlwZX0gY2FsbGJhY2sgLSBDYWxsYmFjayBmdW5jdGlvbiBvciBpbnN0YW5jZSBtZXRob2QgbmFtZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgcmVnaXN0ZXJMaWZlY3ljbGVDYWxsYmFjayhjYWxsYmFja05hbWUsIGNhbGxiYWNrKSB7XG4gICAgY29uc3QgY2FsbGJhY2tzID0gdGhpcy5nZXRMaWZlY3ljbGVDYWxsYmFja3NNYXAoKVxuXG4gICAgaWYgKCFjYWxsYmFja3NbY2FsbGJhY2tOYW1lXSkge1xuICAgICAgY2FsbGJhY2tzW2NhbGxiYWNrTmFtZV0gPSBbXVxuICAgIH1cblxuICAgIGNhbGxiYWNrc1tjYWxsYmFja05hbWVdLnB1c2goY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyB1bnJlZ2lzdGVyIGxpZmVjeWNsZSBjYWxsYmFjay5cbiAgICogQHBhcmFtIHtcImFmdGVyQ3JlYXRlXCIgfCBcImFmdGVyRGVzdHJveVwiIHwgXCJhZnRlclNhdmVcIiB8IFwiYWZ0ZXJVcGRhdGVcIiB8IFwiYmVmb3JlQ3JlYXRlXCIgfCBcImJlZm9yZURlc3Ryb3lcIiB8IFwiYmVmb3JlU2F2ZVwiIHwgXCJiZWZvcmVVcGRhdGVcIiB8IFwiYmVmb3JlVmFsaWRhdGlvblwifSBjYWxsYmFja05hbWUgLSBDYWxsYmFjayB0eXBlLlxuICAgKiBAcGFyYW0ge0xpZmVjeWNsZUNhbGxiYWNrVHlwZX0gY2FsbGJhY2sgLSBQcmV2aW91c2x5IHJlZ2lzdGVyZWQgY2FsbGJhY2suXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIHVucmVnaXN0ZXJMaWZlY3ljbGVDYWxsYmFjayhjYWxsYmFja05hbWUsIGNhbGxiYWNrKSB7XG4gICAgY29uc3QgY2FsbGJhY2tzID0gdGhpcy5nZXRMaWZlY3ljbGVDYWxsYmFja3NNYXAoKVtjYWxsYmFja05hbWVdXG5cbiAgICBpZiAoIWNhbGxiYWNrcykgcmV0dXJuXG5cbiAgICBjb25zdCBjYWxsYmFja0luZGV4ID0gY2FsbGJhY2tzLmluZGV4T2YoY2FsbGJhY2spXG5cbiAgICBpZiAoY2FsbGJhY2tJbmRleCA+PSAwKSBjYWxsYmFja3Muc3BsaWNlKGNhbGxiYWNrSW5kZXgsIDEpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBiZWZvcmUgdmFsaWRhdGlvbi5cbiAgICogQHRlbXBsYXRlIFJcbiAgICogQHRoaXMge01vZGVsQ29uc3RydWN0b3I8Uj59XG4gICAqIEBwYXJhbSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlPFI+fSBjYWxsYmFjayAtIENhbGxiYWNrIGZ1bmN0aW9uIG9yIGluc3RhbmNlIG1ldGhvZCBuYW1lLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBiZWZvcmVWYWxpZGF0aW9uKGNhbGxiYWNrKSB7XG4gICAgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQucmVnaXN0ZXJMaWZlY3ljbGVDYWxsYmFjay5jYWxsKHRoaXMsIFwiYmVmb3JlVmFsaWRhdGlvblwiLCAvKiogQHR5cGUge0xpZmVjeWNsZUNhbGxiYWNrVHlwZX0gKi8gKGNhbGxiYWNrKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJlZm9yZSBzYXZlLlxuICAgKiBAdGVtcGxhdGUgUlxuICAgKiBAdGhpcyB7TW9kZWxDb25zdHJ1Y3RvcjxSPn1cbiAgICogQHBhcmFtIHtMaWZlY3ljbGVDYWxsYmFja1R5cGU8Uj59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZnVuY3Rpb24gb3IgaW5zdGFuY2UgbWV0aG9kIG5hbWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIGJlZm9yZVNhdmUoY2FsbGJhY2spIHtcbiAgICBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZC5yZWdpc3RlckxpZmVjeWNsZUNhbGxiYWNrLmNhbGwodGhpcywgXCJiZWZvcmVTYXZlXCIsIC8qKiBAdHlwZSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlfSAqLyAoY2FsbGJhY2spKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYmVmb3JlIGNyZWF0ZS5cbiAgICogQHRlbXBsYXRlIFJcbiAgICogQHRoaXMge01vZGVsQ29uc3RydWN0b3I8Uj59XG4gICAqIEBwYXJhbSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlPFI+fSBjYWxsYmFjayAtIENhbGxiYWNrIGZ1bmN0aW9uIG9yIGluc3RhbmNlIG1ldGhvZCBuYW1lLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBiZWZvcmVDcmVhdGUoY2FsbGJhY2spIHtcbiAgICBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZC5yZWdpc3RlckxpZmVjeWNsZUNhbGxiYWNrLmNhbGwodGhpcywgXCJiZWZvcmVDcmVhdGVcIiwgLyoqIEB0eXBlIHtMaWZlY3ljbGVDYWxsYmFja1R5cGV9ICovIChjYWxsYmFjaykpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBiZWZvcmUgdXBkYXRlLlxuICAgKiBAdGVtcGxhdGUgUlxuICAgKiBAdGhpcyB7TW9kZWxDb25zdHJ1Y3RvcjxSPn1cbiAgICogQHBhcmFtIHtMaWZlY3ljbGVDYWxsYmFja1R5cGU8Uj59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZnVuY3Rpb24gb3IgaW5zdGFuY2UgbWV0aG9kIG5hbWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIGJlZm9yZVVwZGF0ZShjYWxsYmFjaykge1xuICAgIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkLnJlZ2lzdGVyTGlmZWN5Y2xlQ2FsbGJhY2suY2FsbCh0aGlzLCBcImJlZm9yZVVwZGF0ZVwiLCAvKiogQHR5cGUge0xpZmVjeWNsZUNhbGxiYWNrVHlwZX0gKi8gKGNhbGxiYWNrKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJlZm9yZSBkZXN0cm95LlxuICAgKiBAdGVtcGxhdGUgUlxuICAgKiBAdGhpcyB7TW9kZWxDb25zdHJ1Y3RvcjxSPn1cbiAgICogQHBhcmFtIHtMaWZlY3ljbGVDYWxsYmFja1R5cGU8Uj59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZnVuY3Rpb24gb3IgaW5zdGFuY2UgbWV0aG9kIG5hbWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIGJlZm9yZURlc3Ryb3koY2FsbGJhY2spIHtcbiAgICBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZC5yZWdpc3RlckxpZmVjeWNsZUNhbGxiYWNrLmNhbGwodGhpcywgXCJiZWZvcmVEZXN0cm95XCIsIC8qKiBAdHlwZSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlfSAqLyAoY2FsbGJhY2spKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWZ0ZXIgc2F2ZS5cbiAgICogQHRlbXBsYXRlIFJcbiAgICogQHRoaXMge01vZGVsQ29uc3RydWN0b3I8Uj59XG4gICAqIEBwYXJhbSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlPFI+fSBjYWxsYmFjayAtIENhbGxiYWNrIGZ1bmN0aW9uIG9yIGluc3RhbmNlIG1ldGhvZCBuYW1lLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBhZnRlclNhdmUoY2FsbGJhY2spIHtcbiAgICBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZC5yZWdpc3RlckxpZmVjeWNsZUNhbGxiYWNrLmNhbGwodGhpcywgXCJhZnRlclNhdmVcIiwgLyoqIEB0eXBlIHtMaWZlY3ljbGVDYWxsYmFja1R5cGV9ICovIChjYWxsYmFjaykpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhZnRlciBjcmVhdGUuXG4gICAqIEB0ZW1wbGF0ZSBSXG4gICAqIEB0aGlzIHtNb2RlbENvbnN0cnVjdG9yPFI+fVxuICAgKiBAcGFyYW0ge0xpZmVjeWNsZUNhbGxiYWNrVHlwZTxSPn0gY2FsbGJhY2sgLSBDYWxsYmFjayBmdW5jdGlvbiBvciBpbnN0YW5jZSBtZXRob2QgbmFtZS5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgYWZ0ZXJDcmVhdGUoY2FsbGJhY2spIHtcbiAgICBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZC5yZWdpc3RlckxpZmVjeWNsZUNhbGxiYWNrLmNhbGwodGhpcywgXCJhZnRlckNyZWF0ZVwiLCAvKiogQHR5cGUge0xpZmVjeWNsZUNhbGxiYWNrVHlwZX0gKi8gKGNhbGxiYWNrKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFmdGVyIHVwZGF0ZS5cbiAgICogQHRlbXBsYXRlIFJcbiAgICogQHRoaXMge01vZGVsQ29uc3RydWN0b3I8Uj59XG4gICAqIEBwYXJhbSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlPFI+fSBjYWxsYmFjayAtIENhbGxiYWNrIGZ1bmN0aW9uIG9yIGluc3RhbmNlIG1ldGhvZCBuYW1lLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBhZnRlclVwZGF0ZShjYWxsYmFjaykge1xuICAgIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkLnJlZ2lzdGVyTGlmZWN5Y2xlQ2FsbGJhY2suY2FsbCh0aGlzLCBcImFmdGVyVXBkYXRlXCIsIC8qKiBAdHlwZSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlfSAqLyAoY2FsbGJhY2spKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWZ0ZXIgZGVzdHJveS5cbiAgICogQHRlbXBsYXRlIFJcbiAgICogQHRoaXMge01vZGVsQ29uc3RydWN0b3I8Uj59XG4gICAqIEBwYXJhbSB7TGlmZWN5Y2xlQ2FsbGJhY2tUeXBlPFI+fSBjYWxsYmFjayAtIENhbGxiYWNrIGZ1bmN0aW9uIG9yIGluc3RhbmNlIG1ldGhvZCBuYW1lLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBhZnRlckRlc3Ryb3koY2FsbGJhY2spIHtcbiAgICBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZC5yZWdpc3RlckxpZmVjeWNsZUNhbGxiYWNrLmNhbGwodGhpcywgXCJhZnRlckRlc3Ryb3lcIiwgLyoqIEB0eXBlIHtMaWZlY3ljbGVDYWxsYmFja1R5cGV9ICovIChjYWxsYmFjaykpXG4gIH1cblxuICAvKipcbiAgICogRW5hYmxlcyBhdXRvbWF0aWMgY3JlYXRlL3VwZGF0ZS9kZXN0cm95IGF1ZGl0aW5nIGZvciB0aGlzIG1vZGVsLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBhdWRpdGVkKCkge1xuICAgIHJlZ2lzdGVyQXVkaXRpbmcodGhpcylcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWNsYXJlcyBhbiBhYXNtLXN0eWxlIHN0YXRlIG1hY2hpbmUgb24gdGhpcyBtb2RlbDogbmFtZWQgc3RhdGVzLCBldmVudHNcbiAgICogKGd1YXJkZWQgdHJhbnNpdGlvbnMpLCBhbmQgZW50ZXIvZXhpdCArIGJlZm9yZS9hZnRlciB0cmFuc2l0aW9uIGhvb2tzLiBTZWVcbiAgICogYHN0YXRlLW1hY2hpbmUuanNgLiBHZW5lcmF0ZXMgYGV2ZW50KClgIC8gYGV2ZW50QW5kU2F2ZSgpYCAvIGBjYW5FdmVudCgpYFxuICAgKiB0cmFuc2l0aW9uIG1ldGhvZHMgcGVyIGRlY2xhcmVkIGV2ZW50LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vc3RhdGUtbWFjaGluZS5qc1wiKS5TdGF0ZU1hY2hpbmVEZWZpbml0aW9ufSBkZWZpbml0aW9uIC0gU3RhdGUgbWFjaGluZSBkZWZpbml0aW9uLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBzdGF0ZU1hY2hpbmUoZGVmaW5pdGlvbikge1xuICAgIHN0YXRlTWFjaGluZSh0aGlzLCBkZWZpbml0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhpcyBtb2RlbCdzIHN0YXRlIG1hY2hpbmUgZGVmaW5pdGlvbiwgb3IgbnVsbCB3aGVuIGl0IGRlY2xhcmVzIG5vbmUuXG4gICAqIGBNb2RlbC5zdGF0ZU1hY2hpbmUoLi4uKWAgb3ZlcnJpZGVzIHRoaXMgb24gY2xhc3NlcyB0aGF0IGRlY2xhcmUgYSBtYWNoaW5lLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9zdGF0ZS1tYWNoaW5lLmpzXCIpLlN0YXRlTWFjaGluZURlZmluaXRpb24gfCBudWxsfSAtIFRoZSBzdGF0ZSBtYWNoaW5lIGRlZmluaXRpb24sIG9yIG51bGwgd2hlbiBub25lIGlzIGRlY2xhcmVkLlxuICAgKi9cbiAgc3RhdGljIGdldFN0YXRlTWFjaGluZURlZmluaXRpb24oKSB7XG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoaXMgbW9kZWwncyBzdGF0ZSBjb2x1bW4sIG9yIG51bGwgd2hlbiBpdCBkZWNsYXJlcyBubyBzdGF0ZSBtYWNoaW5lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVsbH0gLSBUaGUgc3RhdGUgY29sdW1uIG5hbWUsIG9yIG51bGwgd2hlbiBubyBzdGF0ZSBtYWNoaW5lIGlzIGRlY2xhcmVkLlxuICAgKi9cbiAgc3RhdGljIGdldFN0YXRlTWFjaGluZUNvbHVtbigpIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhpcyBtb2RlbCdzIGRlY2xhcmVkIHN0YXRlIG5hbWVzIChlbXB0eSB3aGVuIGl0IGhhcyBubyBzdGF0ZSBtYWNoaW5lKS5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSAtIFRoZSBkZWNsYXJlZCBzdGF0ZSBuYW1lcywgb3IgYW4gZW1wdHkgYXJyYXkgd2hlbiBubyBzdGF0ZSBtYWNoaW5lIGlzIGRlY2xhcmVkLlxuICAgKi9cbiAgc3RhdGljIGdldFN0YXRlTWFjaGluZVN0YXRlTmFtZXMoKSB7XG4gICAgcmV0dXJuIFtdXG4gIH1cblxuICAvKipcbiAgICogTWFpbnRhaW5zIGEgY291bnRlciBjb2x1bW4gb24gYSBgYmVsb25nc1RvYCBwYXJlbnQgYXMgdGhlIHN1bSBvZiBhIHBlci1yZWNvcmRcbiAgICogbWFnbml0dWRlLCBrZXB0IGN1cnJlbnQgYnkgYXRvbWljIGluY3JlbWVudHMgZGlmZmVkIG9uIGV2ZXJ5IGNyZWF0ZS91cGRhdGUvXG4gICAqIGRlc3Ryb3kgKGFuZCBtb3ZlZCBiZXR3ZWVuIHBhcmVudHMgd2hlbiB0aGUgZm9yZWlnbiBrZXkgY2hhbmdlcykuIFNlZVxuICAgKiBgY291bnRlci1jYWNoZS1tYWduaXR1ZGUuanNgLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vY291bnRlci1jYWNoZS1tYWduaXR1ZGUuanNcIikuTWFnbml0dWRlQ291bnRlckNhY2hlRGVmaW5pdGlvbn0gZGVmaW5pdGlvbiAtIENvdW50ZXIgY2FjaGUgZGVmaW5pdGlvbi5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBzdGF0aWMgbWFnbml0dWRlQ291bnRlckNhY2hlKGRlZmluaXRpb24pIHtcbiAgICByZWdpc3Rlck1hZ25pdHVkZUNvdW50ZXJDYWNoZSh0aGlzLCBkZWZpbml0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhIGNhbGxiYWNrIGludm9rZWQgYWZ0ZXIgdGhpcyBtb2RlbCB3cml0ZXMgYW4gYXVkaXQgcm93IGZvciB0aGUgYWN0aW9uLlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge3N0cmluZ30gYWN0aW9uIC0gQXVkaXQgYWN0aW9uIG5hbWUuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9hdWRpdGluZy5qc1wiKS5BdWRpdENhbGxiYWNrfSBjYWxsYmFjayAtIENhbGxiYWNrIHRvIHJ1biBhZnRlciBhdWRpdCBjcmVhdGlvbi5cbiAgICogQHJldHVybnMgeygpID0+IHZvaWR9IFVuc3Vic2NyaWJlIGZ1bmN0aW9uLlxuICAgKi9cbiAgc3RhdGljIG9uQXVkaXQoYWN0aW9uLCBjYWxsYmFjaykge1xuICAgIHJldHVybiByZWdpc3RlckF1ZGl0Q2FsbGJhY2sodGhpcywgYWN0aW9uLCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHJlY29yZHMgdGhhdCBkbyBub3QgaGF2ZSBhbiBhdWRpdCByb3cgZm9yIHRoZSBnaXZlbiBhY3Rpb24uXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhY3Rpb24gLSBBdWRpdCBhY3Rpb24gbmFtZS5cbiAgICogQHJldHVybnMge01vZGVsQ2xhc3NRdWVyeTxNQz59IFF1ZXJ5IHNjb3BlZCB0byByZWNvcmRzIHdpdGhvdXQgdGhhdCBhdWRpdCBhY3Rpb24uXG4gICAqL1xuICBzdGF0aWMgd2l0aG91dEF1ZGl0KGFjdGlvbikge1xuICAgIHJldHVybiB3aXRob3V0QXVkaXQodGhpcywgYWN0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHZhbGlkYXRvciB0eXBlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdmFsaWRhdG9yTmFtZSAtIFZhbGlkYXRvciBuYW1lLlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4vdmFsaWRhdG9ycy9iYXNlLmpzXCIpLmRlZmF1bHR9IC0gVGhlIHZhbGlkYXRvciB0eXBlLlxuICAgKi9cbiAgc3RhdGljIGdldFZhbGlkYXRvclR5cGUodmFsaWRhdG9yTmFtZSkge1xuICAgIGlmICghKHZhbGlkYXRvck5hbWUgaW4gdGhpcy52YWxpZGF0b3JUeXBlcygpKSkgdGhyb3cgbmV3IEVycm9yKGBWYWxpZGF0b3IgdHlwZSAke3ZhbGlkYXRvck5hbWV9IG5vdCBmb3VuZGApXG5cbiAgICByZXR1cm4gdGhpcy52YWxpZGF0b3JUeXBlcygpW3ZhbGlkYXRvck5hbWVdXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWxhdGlvbnNoaXAgZXhpc3RzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHJlbGF0aW9uc2hpcCBleGlzdHMuXG4gICAqL1xuICBzdGF0aWMgX3JlbGF0aW9uc2hpcEV4aXN0cyhyZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgaWYgKHJlbGF0aW9uc2hpcE5hbWUgaW4gdGhpcy5nZXRSZWxhdGlvbnNoaXBzTWFwKCkpIHtcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUmVsYXRpb25zaGlwU2NvcGVDYWxsYmFjayB0eXBlLlxuICAgKiBAdHlwZWRlZiB7KHF1ZXJ5OiBpbXBvcnQoXCIuLi9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZD4pID0+IChpbXBvcnQoXCIuLi9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZD4gfCB2b2lkKX0gUmVsYXRpb25zaGlwU2NvcGVDYWxsYmFja1xuICAgKi9cbiAgLyoqXG4gICAqIFJlbGF0aW9uc2hpcERhdGFBcmd1bWVudFR5cGUgdHlwZS5cbiAgICogQHR5cGVkZWYge29iamVjdH0gUmVsYXRpb25zaGlwRGF0YUFyZ3VtZW50VHlwZVxuICAgKiBAcHJvcGVydHkge2Jvb2xlYW59IFthdXRvbG9hZF0gLSBEaXNhYmxlIGF1dG8tYmF0Y2gtcHJlbG9hZCBmb3IgdGhpcyByZWxhdGlvbnNoaXAgYnkgcGFzc2luZyBmYWxzZS4gRGVmYXVsdCB0cnVlLlxuICAgKiBAcHJvcGVydHkge3N0cmluZ30gW2NsYXNzTmFtZV0gLSBNb2RlbCBjbGFzcyBuYW1lIGZvciB0aGUgcmVsYXRlZCByZWNvcmQuXG4gICAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbZGVwZW5kZW50XSAtIERlcGVuZGVudCBhY3Rpb24gd2hlbiBwYXJlbnQgaXMgZGVzdHJveWVkIChlLmcuIFwiZGVzdHJveVwiKS5cbiAgICogQHByb3BlcnR5IHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IFtrbGFzc10gLSBNb2RlbCBjbGFzcyBmb3IgdGhlIHJlbGF0ZWQgcmVjb3JkLlxuICAgKiBAcHJvcGVydHkge1JlbGF0aW9uc2hpcFNjb3BlQ2FsbGJhY2t9IFtzY29wZV0gLSBPcHRpb25hbCBzY29wZSBjYWxsYmFjayBmb3IgdGhlIHJlbGF0aW9uc2hpcC5cbiAgICogQHByb3BlcnR5IHtzdHJpbmd9IFt0eXBlXSAtIFJlbGF0aW9uc2hpcCB0eXBlIChlLmcuIFwiaGFzTWFueVwiLCBcImJlbG9uZ3NUb1wiKS5cbiAgICovXG4gIC8qKlxuICAgKiBSdW5zIGRlZmluZSByZWxhdGlvbnNoaXAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gUmVsYXRpb25zaGlwIG5hbWUuXG4gICAqIEBwYXJhbSB7UmVsYXRpb25zaGlwRGF0YUFyZ3VtZW50VHlwZX0gZGF0YSAtIERhdGEgcGF5bG9hZC5cbiAgICovXG4gIHN0YXRpYyBfZGVmaW5lUmVsYXRpb25zaGlwKHJlbGF0aW9uc2hpcE5hbWUsIGRhdGEpIHtcbiAgICBpZiAoIXJlbGF0aW9uc2hpcE5hbWUpIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCByZWxhdGlvbnNoaXAgbmFtZSBnaXZlbjogJHtyZWxhdGlvbnNoaXBOYW1lfWApXG4gICAgaWYgKHRoaXMuX3JlbGF0aW9uc2hpcEV4aXN0cyhyZWxhdGlvbnNoaXBOYW1lKSkgdGhyb3cgbmV3IEVycm9yKGBSZWxhdGlvbnNoaXAgJHtyZWxhdGlvbnNoaXBOYW1lfSBhbHJlYWR5IGV4aXN0c2ApXG5cbiAgICBjb25zdCBhY3R1YWxEYXRhID0gT2JqZWN0LmFzc2lnbihcbiAgICAgIHtcbiAgICAgICAgbW9kZWxDbGFzczogdGhpcyxcbiAgICAgICAgcmVsYXRpb25zaGlwTmFtZSxcbiAgICAgICAgdHlwZTogXCJoYXNNYW55XCJcbiAgICAgIH0sXG4gICAgICBkYXRhXG4gICAgKVxuXG4gICAgaWYgKCFhY3R1YWxEYXRhLmNsYXNzTmFtZSAmJiAhYWN0dWFsRGF0YS5rbGFzcykge1xuICAgICAgYWN0dWFsRGF0YS5jbGFzc05hbWUgPSBzaW5ndWxhcml6ZU1vZGVsTmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuICAgIH1cblxuICAgIGxldCByZWxhdGlvbnNoaXBcbiAgICBjb25zdCBwcm90b3R5cGUgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzLnByb3RvdHlwZSkpXG5cbiAgICBpZiAoYWN0dWFsRGF0YS50eXBlID09IFwiYmVsb25nc1RvXCIpIHtcbiAgICAgIHJlbGF0aW9uc2hpcCA9IG5ldyBCZWxvbmdzVG9SZWxhdGlvbnNoaXAoYWN0dWFsRGF0YSlcblxuICAgICAgcHJvdG90eXBlW3JlbGF0aW9uc2hpcE5hbWVdID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IHRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICAgICAgcmV0dXJuIHJlbGF0aW9uc2hpcC5sb2FkZWQoKVxuICAgICAgfVxuXG4gICAgICBwcm90b3R5cGVbYGJ1aWxkJHtpbmZsZWN0aW9uLmNhbWVsaXplKHJlbGF0aW9uc2hpcE5hbWUpfWBdID0gZnVuY3Rpb24oLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovIGF0dHJpYnV0ZXMpIHtcbiAgICAgICAgcmV0dXJuIGJ1aWxkUmVsYXRlZFJlY29yZFdpdGhJbnZlcnNlKC8qKiBAdHlwZSB7VmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9ICovICh0aGlzKSwgcmVsYXRpb25zaGlwTmFtZSwgYXR0cmlidXRlcywgdHJ1ZSlcbiAgICAgIH1cblxuICAgICAgcHJvdG90eXBlW2Bsb2FkJHtpbmZsZWN0aW9uLmNhbWVsaXplKHJlbGF0aW9uc2hpcE5hbWUpfWBdID0gYXN5bmMgZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLmxvYWRSZWxhdGlvbnNoaXAocmVsYXRpb25zaGlwTmFtZSlcbiAgICAgIH1cblxuICAgICAgcHJvdG90eXBlW2Ake3JlbGF0aW9uc2hpcE5hbWV9T3JMb2FkYF0gPSBhc3luYyBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMucmVsYXRpb25zaGlwT3JMb2FkKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICB9XG5cbiAgICAgIHByb3RvdHlwZVtgc2V0JHtpbmZsZWN0aW9uLmNhbWVsaXplKHJlbGF0aW9uc2hpcE5hbWUpfWBdID0gZnVuY3Rpb24oLyoqIEB0eXBlIHtWZWxvY2lvdXNEYXRhYmFzZVJlY29yZCB8IG51bGwgfCB1bmRlZmluZWR9ICovIG1vZGVsKSB7XG4gICAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IHRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICAgIGNvbnN0IGZvcmVpZ25LZXlWYWx1ZSA9IHRoaXMuX2JlbG9uZ3NUb0ZvcmVpZ25LZXlWYWx1ZSh7bW9kZWwsIHJlbGF0aW9uc2hpcH0pXG5cbiAgICAgICAgcmVsYXRpb25zaGlwLnNldExvYWRlZChtb2RlbCB8fCB1bmRlZmluZWQpXG4gICAgICAgIHJlbGF0aW9uc2hpcC5zZXRQcmVsb2FkZWQodHJ1ZSlcbiAgICAgICAgcmVsYXRpb25zaGlwLnNldERpcnR5KHRydWUpXG4gICAgICAgIHRoaXMuX3NldENvbHVtbkF0dHJpYnV0ZShyZWxhdGlvbnNoaXAuZ2V0Rm9yZWlnbktleSgpLCBmb3JlaWduS2V5VmFsdWUpXG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChhY3R1YWxEYXRhLnR5cGUgPT0gXCJoYXNNYW55XCIpIHtcbiAgICAgIHJlbGF0aW9uc2hpcCA9IG5ldyBIYXNNYW55UmVsYXRpb25zaGlwKGFjdHVhbERhdGEpXG5cbiAgICAgIHByb3RvdHlwZVtyZWxhdGlvbnNoaXBOYW1lXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gLyoqIEB0eXBlIHtpbXBvcnQoXCIuL2luc3RhbmNlLXJlbGF0aW9uc2hpcHMvaGFzLW1hbnkuanNcIikuZGVmYXVsdDxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPiwgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAodGhpcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSkpXG4gICAgICB9XG5cbiAgICAgIHByb3RvdHlwZVtgJHtyZWxhdGlvbnNoaXBOYW1lfUxvYWRlZGBdID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKS5sb2FkZWQoKVxuICAgICAgfVxuXG4gICAgICBwcm90b3R5cGVbYGxvYWQke2luZmxlY3Rpb24uY2FtZWxpemUocmVsYXRpb25zaGlwTmFtZSl9YF0gPSBhc3luYyBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMubG9hZFJlbGF0aW9uc2hpcChyZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgfVxuXG4gICAgICBwcm90b3R5cGVbYCR7cmVsYXRpb25zaGlwTmFtZX1PckxvYWRgXSA9IGFzeW5jIGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5yZWxhdGlvbnNoaXBPckxvYWQocmVsYXRpb25zaGlwTmFtZSlcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGFjdHVhbERhdGEudHlwZSA9PSBcImhhc09uZVwiKSB7XG4gICAgICByZWxhdGlvbnNoaXAgPSBuZXcgSGFzT25lUmVsYXRpb25zaGlwKGFjdHVhbERhdGEpXG5cbiAgICAgIHByb3RvdHlwZVtyZWxhdGlvbnNoaXBOYW1lXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSkubG9hZGVkKClcbiAgICAgIH1cblxuICAgICAgcHJvdG90eXBlW2BidWlsZCR7aW5mbGVjdGlvbi5jYW1lbGl6ZShyZWxhdGlvbnNoaXBOYW1lKX1gXSA9IGZ1bmN0aW9uKC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyBhdHRyaWJ1dGVzKSB7XG4gICAgICAgIHJldHVybiBidWlsZFJlbGF0ZWRSZWNvcmRXaXRoSW52ZXJzZSgvKiogQHR5cGUge1ZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSAqLyAodGhpcyksIHJlbGF0aW9uc2hpcE5hbWUsIGF0dHJpYnV0ZXMsIGZhbHNlKVxuICAgICAgfVxuXG4gICAgICBwcm90b3R5cGVbYGxvYWQke2luZmxlY3Rpb24uY2FtZWxpemUocmVsYXRpb25zaGlwTmFtZSl9YF0gPSBhc3luYyBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMubG9hZFJlbGF0aW9uc2hpcChyZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgfVxuXG4gICAgICBwcm90b3R5cGVbYCR7cmVsYXRpb25zaGlwTmFtZX1PckxvYWRgXSA9IGFzeW5jIGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5yZWxhdGlvbnNoaXBPckxvYWQocmVsYXRpb25zaGlwTmFtZSlcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIHJlbGF0aW9uc2hpcCB0eXBlOiAke2FjdHVhbERhdGEudHlwZX1gKVxuICAgIH1cblxuICAgIHRoaXMuZ2V0UmVsYXRpb25zaGlwc01hcCgpW3JlbGF0aW9uc2hpcE5hbWVdID0gcmVsYXRpb25zaGlwXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgcmVsYXRpb25zaGlwIGFyZ3MuXG4gICAqIEBwYXJhbSB7UmVsYXRpb25zaGlwU2NvcGVDYWxsYmFjayB8IG9iamVjdCB8IHVuZGVmaW5lZH0gc2NvcGVPck9wdGlvbnMgLSBTY29wZSBjYWxsYmFjayBvciBvcHRpb25zLlxuICAgKiBAcGFyYW0ge29iamVjdCB8IHVuZGVmaW5lZH0gb3B0aW9ucyAtIE9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHt7c2NvcGU6IChSZWxhdGlvbnNoaXBTY29wZUNhbGxiYWNrIHwgdW5kZWZpbmVkKSwgcmVsYXRpb25zaGlwT3B0aW9uczogb2JqZWN0fX0gLSBOb3JtYWxpemVkIGFyZ3VtZW50cy5cbiAgICovXG4gIHN0YXRpYyBfbm9ybWFsaXplUmVsYXRpb25zaGlwQXJncyhzY29wZU9yT3B0aW9ucywgb3B0aW9ucykge1xuICAgIGlmICh0eXBlb2Ygc2NvcGVPck9wdGlvbnMgPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzY29wZTogLyoqIEB0eXBlIHtSZWxhdGlvbnNoaXBTY29wZUNhbGxiYWNrfSAqLyAoc2NvcGVPck9wdGlvbnMpLFxuICAgICAgICByZWxhdGlvbnNoaXBPcHRpb25zOiBvcHRpb25zIHx8IHt9XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHNjb3BlOiB1bmRlZmluZWQsXG4gICAgICByZWxhdGlvbnNoaXBPcHRpb25zOiBzY29wZU9yT3B0aW9ucyB8fCB7fVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYWZ0ZXJDcmVhdGUsIGFmdGVyU2F2ZSwgYW5kIGFmdGVyRGVzdHJveSBjYWxsYmFja3MgdG8gc3luY1xuICAgKiBhIGNvdW50ZXIgY2FjaGUgY29sdW1uIG9uIHRoZSBwYXJlbnQgbW9kZWwuIFRoZSBjb2x1bW4gbmFtZSBmb2xsb3dzXG4gICAqIHRoZSBjb252ZW50aW9uIGA8Y2hpbGRNb2RlbFBsdXJhbENhbWVsQ2FzZT5Db3VudGAuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSByZWxhdGlvbnNoaXBOYW1lIC0gVGhlIGJlbG9uZ3NUbyByZWxhdGlvbnNoaXAgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBfcmVnaXN0ZXJDb3VudGVyQ2FjaGVDYWxsYmFja3MocmVsYXRpb25zaGlwTmFtZSkge1xuICAgIGNvbnN0IENoaWxkTW9kZWwgPSB0aGlzXG5cbiAgICAvKipcbiAgICAgKiBBdG9taWNhbGx5IHJlY29tcHV0ZXMgdGhlIGNvdW50ZXIgY2FjaGUgY29sdW1uIG9uIHRoZSBwYXJlbnQgdmlhIGFcbiAgICAgKiBzaW5nbGUgVVBEQVRFIC4uLiBTRVQgY29sID0gKFNFTEVDVCBDT1VOVCgqKSkgc28gY29uY3VycmVudFxuICAgICAqIGNyZWF0ZXMvZGVzdHJveXMgY2Fubm90IHJhY2UgaW50byBhIHN0YWxlIGNvdW50LlxuICAgICAqIEBwYXJhbSB7bnVtYmVyIHwgc3RyaW5nIHwgbnVsbH0gcGFyZW50SWQgLSBQYXJlbnQgcHJpbWFyeS1rZXkgdmFsdWUuXG4gICAgICogQHBhcmFtIHtWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gcmVjb3JkIC0gQ2hpbGQgcmVjb3JkIG93bmluZyB0aGUgY29ubmVjdGlvbi5cbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBjb3VudGVyIGNhY2hlIGhhcyBiZWVuIHN5bmNlZC5cbiAgICAgKi9cbiAgICBhc3luYyBmdW5jdGlvbiBzeW5jQ291bnRlcihwYXJlbnRJZCwgcmVjb3JkKSB7XG4gICAgICBpZiAoIXBhcmVudElkKSByZXR1cm5cblxuICAgICAgY29uc3QgcmVsYXRpb25zaGlwID0gQ2hpbGRNb2RlbC5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcbiAgICAgIGNvbnN0IFBhcmVudE1vZGVsID0gcmVsYXRpb25zaGlwLmdldFRhcmdldE1vZGVsQ2xhc3MoKVxuXG4gICAgICBpZiAoIVBhcmVudE1vZGVsKSByZXR1cm5cblxuICAgICAgY29uc3QgcHJpbWFyeUtleSA9IHJlbGF0aW9uc2hpcC5nZXRQcmltYXJ5S2V5KClcbiAgICAgIGNvbnN0IGZrID0gcmVsYXRpb25zaGlwLmdldEZvcmVpZ25LZXkoKVxuICAgICAgY29uc3QgY2hpbGRNb2RlbE5hbWUgPSBDaGlsZE1vZGVsLmdldE1vZGVsTmFtZSgpXG4gICAgICBjb25zdCBjb3VudGVyQ29sdW1uID0gaW5mbGVjdGlvbi51bmRlcnNjb3JlKGAke2luZmxlY3Rpb24ucGx1cmFsaXplKGNoaWxkTW9kZWxOYW1lKX1Db3VudGApXG4gICAgICBjb25zdCBwYXJlbnRUYWJsZSA9IFBhcmVudE1vZGVsLnRhYmxlTmFtZSgpXG4gICAgICBjb25zdCBjaGlsZFRhYmxlID0gQ2hpbGRNb2RlbC50YWJsZU5hbWUoKVxuICAgICAgY29uc3QgcGtDb2x1bW4gPSBpbmZsZWN0aW9uLnVuZGVyc2NvcmUocHJpbWFyeUtleSlcbiAgICAgIGNvbnN0IGNvbm5lY3Rpb24gPSByZWNvcmRcbiAgICAgICAgLnF1ZXJ5Rm9yTW9kZWwoUGFyZW50TW9kZWwpXG4gICAgICAgIC5kcml2ZXJcbiAgICAgIGNvbnN0IHF1b3RlZCA9IGNvbm5lY3Rpb24ucXVvdGUocGFyZW50SWQpXG5cbiAgICAgIGNvbnN0IHNxbCA9IGBVUERBVEUgJHtjb25uZWN0aW9uLnF1b3RlVGFibGUocGFyZW50VGFibGUpfSBTRVQgJHtjb25uZWN0aW9uLnF1b3RlQ29sdW1uKGNvdW50ZXJDb2x1bW4pfSA9IChTRUxFQ1QgQ09VTlQoKikgRlJPTSAke2Nvbm5lY3Rpb24ucXVvdGVUYWJsZShjaGlsZFRhYmxlKX0gV0hFUkUgJHtjb25uZWN0aW9uLnF1b3RlQ29sdW1uKGZrKX0gPSAke3F1b3RlZH0pIFdIRVJFICR7Y29ubmVjdGlvbi5xdW90ZUNvbHVtbihwa0NvbHVtbil9ID0gJHtxdW90ZWR9YFxuXG4gICAgICBhd2FpdCBjb25uZWN0aW9uLnF1ZXJ5KHNxbCwge2xvZ05hbWU6IGAke1BhcmVudE1vZGVsLm5hbWV9IFVwZGF0ZWB9KVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFJ1bnMgcmVhZCBmayBhdHRyaWJ1dGUuXG4gICAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcmVjb3JkIC0gQ2hpbGQgcmVjb3JkIGluc3RhbmNlLlxuICAgICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBDdXJyZW50IGZvcmVpZ24ta2V5IGF0dHJpYnV0ZSB2YWx1ZS5cbiAgICAgKi9cbiAgICBmdW5jdGlvbiByZWFkRmtBdHRyaWJ1dGUocmVjb3JkKSB7XG4gICAgICBjb25zdCByZWxhdGlvbnNoaXAgPSBDaGlsZE1vZGVsLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuICAgICAgY29uc3QgZmtBdHRyaWJ1dGUgPSBpbmZsZWN0aW9uLmNhbWVsaXplKHJlbGF0aW9uc2hpcC5nZXRGb3JlaWduS2V5KCkucmVwbGFjZSgvX2lkJC8sIFwiSWRcIiksIHRydWUpXG5cbiAgICAgIHJldHVybiByZWNvcmQucmVhZEF0dHJpYnV0ZShma0F0dHJpYnV0ZSlcbiAgICB9XG5cbiAgICBDaGlsZE1vZGVsLmFmdGVyQ3JlYXRlKGFzeW5jIChyZWNvcmQpID0+IHtcbiAgICAgIGF3YWl0IHN5bmNDb3VudGVyKHJlYWRGa0F0dHJpYnV0ZShyZWNvcmQpLCByZWNvcmQpXG4gICAgfSlcblxuICAgIENoaWxkTW9kZWwuYWZ0ZXJEZXN0cm95KGFzeW5jIChyZWNvcmQpID0+IHtcbiAgICAgIGF3YWl0IHN5bmNDb3VudGVyKHJlYWRGa0F0dHJpYnV0ZShyZWNvcmQpLCByZWNvcmQpXG4gICAgfSlcblxuICAgIENoaWxkTW9kZWwuYmVmb3JlU2F2ZShhc3luYyAocmVjb3JkKSA9PiB7XG4gICAgICBjb25zdCBtb2RlbCA9IC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIChyZWNvcmQpXG5cbiAgICAgIGlmIChtb2RlbC5pc05ld1JlY29yZCgpKSByZXR1cm5cblxuICAgICAgY29uc3QgcmVsYXRpb25zaGlwID0gQ2hpbGRNb2RlbC5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwTmFtZSlcbiAgICAgIGNvbnN0IGZrQ29sdW1uID0gcmVsYXRpb25zaGlwLmdldEZvcmVpZ25LZXkoKVxuXG4gICAgICAvLyBEZXRlY3QgRksgY2hhbmdlIHZpYSBkaXJlY3QgYXR0cmlidXRlIGFzc2lnbm1lbnQgb3IgcmVsYXRpb25zaGlwIHNldHRlci5cbiAgICAgIGNvbnN0IGRpcmVjdENoYW5nZSA9IGZrQ29sdW1uIGluIG1vZGVsLl9jaGFuZ2VzXG4gICAgICBjb25zdCBiZWxvbmdzVG9DaGFuZ2UgPSBtb2RlbC5faW5zdGFuY2VSZWxhdGlvbnNoaXBzPy5bcmVsYXRpb25zaGlwTmFtZV0/LmdldERpcnR5Py4oKVxuXG4gICAgICBpZiAoZGlyZWN0Q2hhbmdlIHx8IGJlbG9uZ3NUb0NoYW5nZSkge1xuICAgICAgICBtb2RlbFtgX2NvdW50ZXJDYWNoZVByZXZfJHtyZWxhdGlvbnNoaXBOYW1lfWBdID0gbW9kZWwuX2F0dHJpYnV0ZXNbZmtDb2x1bW5dXG4gICAgICB9XG4gICAgfSlcblxuICAgIENoaWxkTW9kZWwuYWZ0ZXJTYXZlKGFzeW5jIChyZWNvcmQpID0+IHtcbiAgICAgIGNvbnN0IG1vZGVsID0gLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHJlY29yZClcbiAgICAgIGNvbnN0IHByZXZLZXkgPSBgX2NvdW50ZXJDYWNoZVByZXZfJHtyZWxhdGlvbnNoaXBOYW1lfWBcbiAgICAgIGNvbnN0IHByZXZpb3VzUGFyZW50SWQgPSBtb2RlbFtwcmV2S2V5XVxuXG4gICAgICBpZiAocHJldmlvdXNQYXJlbnRJZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGRlbGV0ZSBtb2RlbFtwcmV2S2V5XVxuICAgICAgICBhd2FpdCBzeW5jQ291bnRlcihwcmV2aW91c1BhcmVudElkLCByZWNvcmQpXG4gICAgICAgIGF3YWl0IHN5bmNDb3VudGVyKHJlYWRGa0F0dHJpYnV0ZShtb2RlbCksIHJlY29yZClcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHJlbGF0aW9uc2hpcCBieSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi9yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdH0gLSBUaGUgcmVsYXRpb25zaGlwIGJ5IG5hbWUuXG4gICAqL1xuICBzdGF0aWMgZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpIHtcbiAgICBjb25zdCByZWxhdGlvbnNoaXAgPSB0aGlzLmdldFJlbGF0aW9uc2hpcHNNYXAoKVtyZWxhdGlvbnNoaXBOYW1lXVxuXG4gICAgaWYgKCFyZWxhdGlvbnNoaXApIHRocm93IG5ldyBFcnJvcihgTm8gcmVsYXRpb25zaGlwIGluICR7dGhpcy5uYW1lfSBjYWxsZWQgXCIke3JlbGF0aW9uc2hpcE5hbWV9XCIgaW4gbGlzdDogJHtPYmplY3Qua2V5cyh0aGlzLmdldFJlbGF0aW9uc2hpcHNNYXAoKSkuam9pbihcIiwgXCIpfWApXG5cbiAgICByZXR1cm4gcmVsYXRpb25zaGlwXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcmVsYXRpb25zaGlwcy5cbiAgICogQHJldHVybnMge0FycmF5PGltcG9ydChcIi4vcmVsYXRpb25zaGlwcy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAtIFRoZSByZWxhdGlvbnNoaXBzLlxuICAgKi9cbiAgc3RhdGljIGdldFJlbGF0aW9uc2hpcHMoKSB7XG4gICAgcmV0dXJuIE9iamVjdC52YWx1ZXModGhpcy5nZXRSZWxhdGlvbnNoaXBzTWFwKCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcmVsYXRpb25zaGlwcyBtYXAuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3JlbGF0aW9uc2hpcHMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gLSBSZWxhdGlvbnNoaXAgZGVmaW5pdGlvbnMga2V5ZWQgYnkgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBnZXRSZWxhdGlvbnNoaXBzTWFwKCkge1xuICAgIGlmICghT2JqZWN0Lmhhc093bih0aGlzLCBcIl9yZWxhdGlvbnNoaXBzXCIpIHx8ICF0aGlzLl9yZWxhdGlvbnNoaXBzKSB7XG4gICAgICAvKipcbiAgICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuL3JlbGF0aW9uc2hpcHMvYmFzZS5qc1wiKS5kZWZhdWx0Pn0gKi9cbiAgICAgIHRoaXMuX3JlbGF0aW9uc2hpcHMgPSB7fVxuICAgIH1cblxuICAgIHJldHVybiAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4vcmVsYXRpb25zaGlwcy9iYXNlLmpzXCIpLmRlZmF1bHQ+fSAqLyAodGhpcy5fcmVsYXRpb25zaGlwcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCByZWxhdGlvbnNoaXAgbmFtZXMuXG4gICAqIEByZXR1cm5zIHtBcnJheTxzdHJpbmc+fSAtIFRoZSByZWxhdGlvbnNoaXAgbmFtZXMuXG4gICAqL1xuICBzdGF0aWMgZ2V0UmVsYXRpb25zaGlwTmFtZXMoKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0UmVsYXRpb25zaGlwcygpLm1hcCgocmVsYXRpb25zaGlwKSA9PiByZWxhdGlvbnNoaXAuZ2V0UmVsYXRpb25zaGlwTmFtZSgpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVyIGEgY29uc3VtZXItZGVmaW5lZCBxdWVyeURhdGEgZW50cnkuIFRoZSBjYWxsYmFjayByZWNlaXZlc1xuICAgKiBhIGdyb3VwZWQgcXVlcnkgYWxyZWFkeSBqb2luZWQgZG93biB0aGUgcmVsYXRpb25zaGlwIGNoYWluIGZyb20gdGhlXG4gICAqIHJvb3Qgb2YgYC5xdWVyeURhdGEoLi4uKWAgdG8gdGhpcyBtb2RlbCwgYWxyZWFkeSBmaWx0ZXJlZCBieSB0aGVcbiAgICogcm9vdCBwYXJlbnQgSURzLCBhbmQgd2l0aCBgcGFyZW50X2lkYCBwcmUtc2VsZWN0ZWQg4oCUIHNvIHRoZSBmblxuICAgKiBvbmx5IG5lZWRzIHRvIGFkZCBpdHMgb3duIFNFTEVDVCAoYW5kIG9wdGlvbmFsbHkgam9pbnMvd2hlcmUpLiBBbnlcbiAgICogYWxpYXNlcyB0aGUgZm4gc2VsZWN0cyBhcmUgYXR0YWNoZWQgdG8gZWFjaCAqKnJvb3QqKiByZWNvcmQgdmlhXG4gICAqIGByZWNvcmQucXVlcnlEYXRhKGFsaWFzTmFtZSlgLiBNdWx0aS1jb2x1bW4gc2VsZWN0cyBhcmUgZmluZSDigJQgb25lXG4gICAqIGFsaWFzIG1hcHMgdG8gb25lIHF1ZXJ5RGF0YSBrZXkuXG4gICAqXG4gICAqICoqUXVvdGUgQVMgYWxpYXNlcyBvbiBQb3N0Z3JlU1FMLioqIFBvc3RncmVTUUwgZm9sZHMgdW5xdW90ZWRcbiAgICogaWRlbnRpZmllcnMgKGluY2x1ZGluZyBTRUxFQ1QgYWxpYXNlcykgdG8gbG93ZXJjYXNlLCBzbyBhXG4gICAqIGAuLi4gQVMgbWFudWFsVGFza3NDb3VudGAgbGFuZHMgaW4gdGhlIHJlc3VsdCByb3cgYXNcbiAgICogYG1hbnVhbHRhc2tzY291bnRgIHdoaWxlIHRoZSBsb29rdXAgYHJlY29yZC5xdWVyeURhdGEoXCJtYW51YWxUYXNrc0NvdW50XCIpYFxuICAgKiBuZXZlciBmaW5kcyBpdC4gVXNlIGBkcml2ZXIucXVvdGVDb2x1bW4oXCJtYW51YWxUYXNrc0NvdW50XCIpYCBmb3IgdGhlXG4gICAqIGFsaWFzIHRvIHByZXNlcnZlIHRoZSBjYXNlIG9uIGV2ZXJ5IHN1cHBvcnRlZCBkcml2ZXI6XG4gICAqICAgcXVlcnkuc2VsZWN0KGBDT1VOVCguLi4pIEFTICR7ZHJpdmVyLnF1b3RlQ29sdW1uKFwibWFudWFsVGFza3NDb3VudFwiKX1gKVxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIElkZW50aWZpZXIgdXNlZCBpbiB0aGUgYC5xdWVyeURhdGEoLi4uKWAgc3BlYy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9xdWVyeS9xdWVyeS1kYXRhLmpzXCIpLlF1ZXJ5RGF0YUZufSBmbiAtIENhbGxiYWNrIHRoYXQgbXV0YXRlcyB0aGUgcXVlcnkuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIHF1ZXJ5RGF0YShuYW1lLCBmbikge1xuICAgIGlmICghbmFtZSB8fCB0eXBlb2YgbmFtZSAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHF1ZXJ5RGF0YSBuYW1lOiAke25hbWV9YClcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGZuICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgcXVlcnlEYXRhIGZuIGZvciAke3RoaXMubmFtZX0ucXVlcnlEYXRhKCR7SlNPTi5zdHJpbmdpZnkobmFtZSl9KSBtdXN0IGJlIGEgZnVuY3Rpb25gKVxuICAgIH1cblxuICAgIGNvbnN0IG1hcCA9IHRoaXMuZ2V0UXVlcnlEYXRhTWFwKClcblxuICAgIC8vIFVzZSBPYmplY3QuaGFzT3duIHNvIGEgbmFtZSB0aGF0IGhhcHBlbnMgdG8gbWF0Y2ggYW4gaW5oZXJpdGVkXG4gICAgLy8gT2JqZWN0LnByb3RvdHlwZSBrZXkgKGUuZy4gXCJ0b1N0cmluZ1wiLCBcImNvbnN0cnVjdG9yXCIpIGlzbid0XG4gICAgLy8gZmFsc2VseSB0cmVhdGVkIGFzIGFscmVhZHkgcmVnaXN0ZXJlZC5cbiAgICBpZiAoT2JqZWN0Lmhhc093bihtYXAsIG5hbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHF1ZXJ5RGF0YSBmb3IgJHt0aGlzLm5hbWV9LiR7bmFtZX0gaXMgYWxyZWFkeSByZWdpc3RlcmVkYClcbiAgICB9XG5cbiAgICBtYXBbbmFtZV0gPSBmblxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHF1ZXJ5IGRhdGEgbWFwLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vcXVlcnkvcXVlcnktZGF0YS5qc1wiKS5RdWVyeURhdGFGbj59IC0gcXVlcnlEYXRhIHJlZ2lzdHJhdGlvbnMga2V5ZWQgYnkgbmFtZS5cbiAgICovXG4gIHN0YXRpYyBnZXRRdWVyeURhdGFNYXAoKSB7XG4gICAgaWYgKCFPYmplY3QuaGFzT3duKHRoaXMsIFwiX3F1ZXJ5RGF0YVJlZ2lzdHJhdGlvbnNcIikgfHwgIXRoaXMuX3F1ZXJ5RGF0YVJlZ2lzdHJhdGlvbnMpIHtcbiAgICAgIC8vIFByb3RvdHlwZS1sZXNzIG1hcCBzbyBicmFja2V0IGFjY2VzcyBjYW4gb25seSBldmVyIHN1cmZhY2VcbiAgICAgIC8vIHJlZ2lzdHJhdGlvbnMgYWN0dWFsbHkgbWFkZSBvbiB0aGlzIGNsYXNzIOKAlCBuZXZlciBpbmhlcml0ZWRcbiAgICAgIC8vIE9iamVjdC5wcm90b3R5cGUgbWVtYmVycy5cbiAgICAgIC8qKlxuICAgICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL3F1ZXJ5L3F1ZXJ5LWRhdGEuanNcIikuUXVlcnlEYXRhRm4+fSAqL1xuICAgICAgdGhpcy5fcXVlcnlEYXRhUmVnaXN0cmF0aW9ucyA9IE9iamVjdC5jcmVhdGUobnVsbClcbiAgICB9XG5cbiAgICByZXR1cm4gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBpbXBvcnQoXCIuLi9xdWVyeS9xdWVyeS1kYXRhLmpzXCIpLlF1ZXJ5RGF0YUZuPn0gKi8gKHRoaXMuX3F1ZXJ5RGF0YVJlZ2lzdHJhdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcXVlcnkgZGF0YSBieSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIHF1ZXJ5RGF0YSBuYW1lLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vcXVlcnkvcXVlcnktZGF0YS5qc1wiKS5RdWVyeURhdGFGbiB8IG51bGx9IC0gUmVnaXN0ZXJlZCBmbiBvciBudWxsIHdoZW4gbm90IGZvdW5kLlxuICAgKi9cbiAgc3RhdGljIGdldFF1ZXJ5RGF0YUJ5TmFtZShuYW1lKSB7XG4gICAgY29uc3QgbWFwID0gdGhpcy5nZXRRdWVyeURhdGFNYXAoKVxuXG4gICAgLy8gT3duLXByb3BlcnR5IGxvb2t1cCBzbyBhIHNwZWMgY29udGFpbmluZyBlLmcuIFwidG9TdHJpbmdcIiBkb2Vzbid0XG4gICAgLy8gcmVzb2x2ZSB0byBhbiBpbmhlcml0ZWQgT2JqZWN0LnByb3RvdHlwZSBtZW1iZXIg4oCUIG1hdGNoaW5nIHRoZVxuICAgIC8vIE9iamVjdC5oYXNPd24gZ3VhcmQgdXNlZCB3aGVuIHJlZ2lzdGVyaW5nLlxuICAgIHJldHVybiBPYmplY3QuaGFzT3duKG1hcCwgbmFtZSkgPyBtYXBbbmFtZV0gOiBudWxsXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgYXR0YWNobWVudHMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZWNvcmRBdHRhY2htZW50Q29uZmlndXJhdGlvbj59IC0gQXR0YWNobWVudCBkZWZpbml0aW9ucy5cbiAgICovXG4gIHN0YXRpYyBnZXRBdHRhY2htZW50cygpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRBdHRhY2htZW50c01hcCgpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBhdHRhY2htZW50IGRlZmluaXRpb25zIHRocm91Z2ggdGhlIG1vZGVsIGNvbnRyYWN0IHNoYXJlZCB3aXRoXG4gICAqIGZyb250ZW5kIG1vZGVsIGNsYXNzZXMuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBSZWNvcmRBdHRhY2htZW50Q29uZmlndXJhdGlvbj59IC0gQXR0YWNobWVudCBkZWZpbml0aW9ucy5cbiAgICovXG4gIHN0YXRpYyBhdHRhY2htZW50RGVmaW5pdGlvbnMoKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0QXR0YWNobWVudHNNYXAoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGF0dGFjaG1lbnQgYnkgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dGFjaG1lbnROYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkQXR0YWNobWVudENvbmZpZ3VyYXRpb259IC0gQXR0YWNobWVudCBkZWZpbml0aW9uLlxuICAgKi9cbiAgc3RhdGljIGdldEF0dGFjaG1lbnRCeU5hbWUoYXR0YWNobWVudE5hbWUpIHtcbiAgICBjb25zdCBkZWZpbml0aW9uID0gdGhpcy5nZXRBdHRhY2htZW50c01hcCgpW2F0dGFjaG1lbnROYW1lXVxuXG4gICAgaWYgKCFkZWZpbml0aW9uKSB0aHJvdyBuZXcgRXJyb3IoYE5vIGF0dGFjaG1lbnQgaW4gJHt0aGlzLm5hbWV9IGNhbGxlZCBcIiR7YXR0YWNobWVudE5hbWV9XCIgaW4gbGlzdDogJHtPYmplY3Qua2V5cyh0aGlzLmdldEF0dGFjaG1lbnRzTWFwKCkpLmpvaW4oXCIsIFwiKX1gKVxuXG4gICAgcmV0dXJuIGRlZmluaXRpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCByZWxhdGlvbnNoaXAgYnkgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vaW5zdGFuY2UtcmVsYXRpb25zaGlwcy9iYXNlLmpzXCIpLmRlZmF1bHR9IC0gVGhlIHJlbGF0aW9uc2hpcCBieSBuYW1lLlxuICAgKi9cbiAgZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpIHtcbiAgICBpZiAoIShyZWxhdGlvbnNoaXBOYW1lIGluIHRoaXMuX2luc3RhbmNlUmVsYXRpb25zaGlwcykpIHtcbiAgICAgIGNvbnN0IG1vZGVsQ2xhc3NSZWxhdGlvbnNoaXAgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKVxuICAgICAgICAuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgICAgIC5yZXNvbHZlRm9yUmVjb3JkKHRoaXMpXG4gICAgICBjb25zdCByZWxhdGlvbnNoaXBUeXBlID0gbW9kZWxDbGFzc1JlbGF0aW9uc2hpcC5nZXRUeXBlKClcbiAgICAgIGxldCBpbnN0YW5jZVJlbGF0aW9uc2hpcFxuXG4gICAgICBpZiAocmVsYXRpb25zaGlwVHlwZSA9PSBcImJlbG9uZ3NUb1wiKSB7XG4gICAgICAgIGluc3RhbmNlUmVsYXRpb25zaGlwID0gbmV3IEJlbG9uZ3NUb0luc3RhbmNlUmVsYXRpb25zaGlwKHttb2RlbDogdGhpcywgcmVsYXRpb25zaGlwOiBtb2RlbENsYXNzUmVsYXRpb25zaGlwfSlcbiAgICAgIH0gZWxzZSBpZiAocmVsYXRpb25zaGlwVHlwZSA9PSBcImhhc01hbnlcIikge1xuICAgICAgICBpbnN0YW5jZVJlbGF0aW9uc2hpcCA9IG5ldyBIYXNNYW55SW5zdGFuY2VSZWxhdGlvbnNoaXAoe21vZGVsOiB0aGlzLCByZWxhdGlvbnNoaXA6IG1vZGVsQ2xhc3NSZWxhdGlvbnNoaXB9KVxuICAgICAgfSBlbHNlIGlmIChyZWxhdGlvbnNoaXBUeXBlID09IFwiaGFzT25lXCIpIHtcbiAgICAgICAgaW5zdGFuY2VSZWxhdGlvbnNoaXAgPSBuZXcgSGFzT25lSW5zdGFuY2VSZWxhdGlvbnNoaXAoe21vZGVsOiB0aGlzLCByZWxhdGlvbnNoaXA6IG1vZGVsQ2xhc3NSZWxhdGlvbnNoaXB9KVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIHJlbGF0aW9uc2hpcCB0eXBlOiAke3JlbGF0aW9uc2hpcFR5cGV9YClcbiAgICAgIH1cblxuICAgICAgdGhpcy5faW5zdGFuY2VSZWxhdGlvbnNoaXBzW3JlbGF0aW9uc2hpcE5hbWVdID0gaW5zdGFuY2VSZWxhdGlvbnNoaXBcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5faW5zdGFuY2VSZWxhdGlvbnNoaXBzW3JlbGF0aW9uc2hpcE5hbWVdXG4gIH1cblxuICAvKipcbiAgICogUHJlbG9hZHMgcmVsYXRpb25zaGlwKHMpIG9udG8gdGhpcyBhbHJlYWR5LWxvYWRlZCByZWNvcmQuIEFjY2VwdHMgZWl0aGVyIGFcbiAgICogcXVlcnkgYnVpbHQgdmlhIGBNb2RlbC5wcmVsb2FkKC4uLikuc2VsZWN0KC4uLilgIG9yIGEgcmF3IHByZWxvYWQgc3BlY1xuICAgKiAoc3RyaW5nIC8gYXJyYXkgLyBuZXN0ZWQgb2JqZWN0KS4gQSByZWxhdGlvbnNoaXAgdGhhdCBpcyBhbHJlYWR5IHByZWxvYWRlZFxuICAgKiB3aXRoIGFsbCB0aGUgcmVxdWlyZWQgY29sdW1ucyBwcmVzZW50IGlzIGxlZnQgdW50b3VjaGVkIHVubGVzcyBgZm9yY2VgIGlzXG4gICAqIHNldC4gUHJlbG9hZGluZyBvbnRvIHRoZSByZWxhdGlvbnNoaXAgY2FjaGUgbGV0cyBsYXRlciBhY2Nlc3NvcnMgcmV1c2UgdGhlXG4gICAqIGxvYWRlZCBkYXRhIGluc3RlYWQgb2YgaXNzdWluZyBpZGVudGljYWwgcXVlcmllcy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0IHwgaW1wb3J0KFwiLi4vcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZCB8IHN0cmluZyB8IEFycmF5PHN0cmluZyB8IGltcG9ydChcIi4uL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmQ+fSBxdWVyeU9yU3BlYyAtIFByZWxvYWQgc291cmNlLlxuICAgKiBAcGFyYW0ge3tmb3JjZT86IGJvb2xlYW59fSBbb3B0aW9uc10gLSBPcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHByZWxvYWRpbmcgY29tcGxldGVzLlxuICAgKi9cbiAgYXN5bmMgcHJlbG9hZChxdWVyeU9yU3BlYywgb3B0aW9ucyA9IHt9KSB7XG4gICAgYXdhaXQgUHJlbG9hZGVyLnByZWxvYWQoW3RoaXNdLCBxdWVyeU9yU3BlYywgb3B0aW9ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxvYWQgcmVsYXRpb25zaGlwLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gTG9hZGVkIHJlbGF0aW9uc2hpcCB2YWx1ZS5cbiAgICovXG4gIGFzeW5jIGxvYWRSZWxhdGlvbnNoaXAocmVsYXRpb25zaGlwTmFtZSkge1xuICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IHRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG5cbiAgICBhd2FpdCByZWxhdGlvbnNoaXAubG9hZCgpXG5cbiAgICByZXR1cm4gcmVsYXRpb25zaGlwLmxvYWRlZCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWxhdGlvbnNoaXAgb3IgbG9hZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHBhcmFtIHt7cHJlbG9hZFRyYW5zbGF0aW9ucz86IGJvb2xlYW59fSBbb3B0aW9uc10gLSBMb2FkIG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBMb2FkZWQgcmVsYXRpb25zaGlwIHZhbHVlLlxuICAgKi9cbiAgYXN5bmMgcmVsYXRpb25zaGlwT3JMb2FkKHJlbGF0aW9uc2hpcE5hbWUsIG9wdGlvbnMgPSB7fSkge1xuICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IHRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgbGV0IGxvYWRlZCA9IGF3YWl0IHJlbGF0aW9uc2hpcC5hdXRvbG9hZE9yTG9hZCgpXG5cbiAgICBpZiAob3B0aW9ucy5wcmVsb2FkVHJhbnNsYXRpb25zKSB7XG4gICAgICBsb2FkZWQgPSBhd2FpdCB0aGlzLl9wcmVsb2FkTG9hZGVkUmVsYXRpb25zaGlwVHJhbnNsYXRpb25zKGxvYWRlZClcbiAgICB9XG5cbiAgICByZXR1cm4gbG9hZGVkXG4gIH1cblxuICAvKipcbiAgICogUHJlbG9hZHMgdHJhbnNsYXRpb25zIG9uIGEgbG9hZGVkIHJlbGF0aW9uc2hpcCB0YXJnZXQgd2hlbiBleHBsaWNpdGx5IHJlcXVlc3RlZC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gbG9hZGVkIC0gTG9hZGVkIHJlbGF0aW9uc2hpcCB2YWx1ZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFJlbGF0aW9uc2hpcCB2YWx1ZSBhZnRlciB0cmFuc2xhdGlvbiBwcmVsb2FkLlxuICAgKi9cbiAgYXN5bmMgX3ByZWxvYWRMb2FkZWRSZWxhdGlvbnNoaXBUcmFuc2xhdGlvbnMobG9hZGVkKSB7XG4gICAgaWYgKCFsb2FkZWQgfHwgIWxvYWRlZC5pc1BlcnNpc3RlZCgpIHx8ICFhd2FpdCBsb2FkZWQuZ2V0TW9kZWxDbGFzcygpLmhhc1RyYW5zbGF0aW9uc1RhYmxlKCkpIHJldHVybiBsb2FkZWRcblxuICAgIGNvbnN0IHRyYW5zbGF0aW9uc1JlbGF0aW9uc2hpcCA9IGxvYWRlZC5nZXRSZWxhdGlvbnNoaXBCeU5hbWUoXCJ0cmFuc2xhdGlvbnNcIilcblxuICAgIGlmICh0cmFuc2xhdGlvbnNSZWxhdGlvbnNoaXAuZ2V0UHJlbG9hZGVkKCkpIHJldHVybiBsb2FkZWRcblxuICAgIGF3YWl0IGxvYWRlZC5wcmVsb2FkKHt0cmFuc2xhdGlvbnM6IHt9fSlcblxuICAgIHJldHVybiBsb2FkZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBhdHRhY2htZW50IGJ5IG5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRhY2htZW50TmFtZSAtIEF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHJldHVybnMge1JlY29yZEF0dGFjaG1lbnRIYW5kbGV9IC0gQXR0YWNobWVudCBoYW5kbGUuXG4gICAqL1xuICBnZXRBdHRhY2htZW50QnlOYW1lKGF0dGFjaG1lbnROYW1lKSB7XG4gICAgaWYgKCEoYXR0YWNobWVudE5hbWUgaW4gdGhpcy5fYXR0YWNobWVudHMpKSB7XG4gICAgICBjb25zdCBhdHRhY2htZW50RGVmaW5pdGlvbiA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldEF0dGFjaG1lbnRCeU5hbWUoYXR0YWNobWVudE5hbWUpXG5cbiAgICAgIHRoaXMuX2F0dGFjaG1lbnRzW2F0dGFjaG1lbnROYW1lXSA9IG5ldyBSZWNvcmRBdHRhY2htZW50SGFuZGxlKHtcbiAgICAgICAgbW9kZWw6IHRoaXMsXG4gICAgICAgIG5hbWU6IGF0dGFjaG1lbnROYW1lLFxuICAgICAgICB0eXBlOiBhdHRhY2htZW50RGVmaW5pdGlvbi50eXBlXG4gICAgICB9KVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9hdHRhY2htZW50c1thdHRhY2htZW50TmFtZV1cbiAgfVxuXG4gIC8qKlxuICAgKiBBZGRzIGEgYmVsb25ncy10by1yZWxhdGlvbnNoaXAgdG8gdGhlIG1vZGVsLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSBUaGUgbmFtZSBvZiB0aGUgcmVsYXRpb25zaGlwLlxuICAgKiBAcGFyYW0ge1JlbGF0aW9uc2hpcFNjb3BlQ2FsbGJhY2sgfCBvYmplY3R9IFtzY29wZU9yT3B0aW9uc10gVGhlIHNjb3BlIGNhbGxiYWNrIG9yIG9wdGlvbnMgZm9yIHRoZSByZWxhdGlvbnNoaXAuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbb3B0aW9uc10gVGhlIG9wdGlvbnMgZm9yIHRoZSByZWxhdGlvbnNoaXAuXG4gICAqL1xuICBzdGF0aWMgYmVsb25nc1RvKHJlbGF0aW9uc2hpcE5hbWUsIHNjb3BlT3JPcHRpb25zLCBvcHRpb25zKSB7XG4gICAgY29uc3Qge3Njb3BlLCByZWxhdGlvbnNoaXBPcHRpb25zfSA9IHRoaXMuX25vcm1hbGl6ZVJlbGF0aW9uc2hpcEFyZ3Moc2NvcGVPck9wdGlvbnMsIG9wdGlvbnMpXG5cbiAgICB0aGlzLl9kZWZpbmVSZWxhdGlvbnNoaXAocmVsYXRpb25zaGlwTmFtZSwgT2JqZWN0LmFzc2lnbih7dHlwZTogXCJiZWxvbmdzVG9cIiwgc2NvcGV9LCByZWxhdGlvbnNoaXBPcHRpb25zKSlcblxuICAgIGlmICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAocmVsYXRpb25zaGlwT3B0aW9ucyk/LmNvdW50ZXJDYWNoZSkge1xuICAgICAgdGhpcy5fcmVnaXN0ZXJDb3VudGVyQ2FjaGVDYWxsYmFja3MocmVsYXRpb25zaGlwTmFtZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb25uZWN0aW9uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3NdIC0gT3B0aW9ucy5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5lbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZV0gLSBXaGV0aGVyIHRlbmFudC1zd2l0Y2hlZCBtb2RlbHMgbXVzdCByZXNvbHZlIGEgdGVuYW50IGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gLSBUaGUgY29ubmVjdGlvbi5cbiAgICovXG4gIHN0YXRpYyBjb25uZWN0aW9uKHtlbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZSA9IHRydWUsIC4uLnJlc3RBcmdzfSA9IHt9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcblxuICAgIGNvbnN0IGRhdGFiYXNlUG9vbCA9IHRoaXMuX2dldENvbmZpZ3VyYXRpb24oKS5nZXREYXRhYmFzZVBvb2wodGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoe2VuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlfSkpXG4gICAgY29uc3QgY29ubmVjdGlvbiA9IGRhdGFiYXNlUG9vbC5nZXRDdXJyZW50Q29ubmVjdGlvbigpXG5cbiAgICBpZiAoIWNvbm5lY3Rpb24pIHRocm93IG5ldyBFcnJvcihcIk5vIGNvbm5lY3Rpb24/XCIpXG5cbiAgICByZXR1cm4gY29ubmVjdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3JlYXRlLlxuICAgKiBAdGVtcGxhdGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gQ3JlYXRlQXR0cmlidXRlc1xuICAgKiBAdGVtcGxhdGUge1ZlbG9jaW91c0RhdGFiYXNlUmVjb3JkPENyZWF0ZUF0dHJpYnV0ZXM+fSBNb2RlbFxuICAgKiBAdGhpcyB7e25ldyAoY2hhbmdlcz86IENyZWF0ZUF0dHJpYnV0ZXMpOiBNb2RlbH0gJiB0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9XG4gICAqIEBwYXJhbSB7Q3JlYXRlQXR0cmlidXRlc30gW2F0dHJpYnV0ZXNdIC0gQXR0cmlidXRlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8TW9kZWw+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNyZWF0ZS5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBjcmVhdGUoYXR0cmlidXRlcykge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlSW5pdGlhbGl6ZWQoKVxuXG4gICAgY29uc3QgcmVjb3JkID0gLyoqIEB0eXBlIHtNb2RlbH0gKi8gKG5ldyB0aGlzKGF0dHJpYnV0ZXMpKVxuXG4gICAgYXdhaXQgcmVjb3JkLnNhdmUoKVxuXG4gICAgcmV0dXJuIHJlY29yZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IC0gVGhlIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBzdGF0aWMgX2dldENvbmZpZ3VyYXRpb24oKSB7XG4gICAgaWYgKCF0aGlzLl9jb25maWd1cmF0aW9uKSB7XG4gICAgICB0aGlzLl9jb25maWd1cmF0aW9uID0gQ29uZmlndXJhdGlvbi5jdXJyZW50KClcblxuICAgICAgaWYgKCF0aGlzLl9jb25maWd1cmF0aW9uKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcIkNvbmZpZ3VyYXRpb24gaGFzbid0IGJlZW4gc2V0IChtb2RlbCBjbGFzcyBwcm9iYWJseSBoYXNuJ3QgYmVlbiBpbml0aWFsaXplZClcIilcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fY29uZmlndXJhdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IC0gVGhlIGNvbmZpZ3VyYXRpb24uXG4gICAqL1xuICBfZ2V0Q29uZmlndXJhdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRNb2RlbENsYXNzKCkuX2dldENvbmZpZ3VyYXRpb24oKVxuICB9XG5cbiAgLyoqXG4gICAqIEFkZHMgYSBoYXMtbWFueS1yZWxhdGlvbnNoaXAgdG8gdGhlIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSBUaGUgbmFtZSBvZiB0aGUgcmVsYXRpb25zaGlwIChlLmcuIFwicG9zdHNcIilcbiAgICogQHBhcmFtIHtSZWxhdGlvbnNoaXBTY29wZUNhbGxiYWNrIHwgb2JqZWN0fSBbc2NvcGVPck9wdGlvbnNdIFRoZSBzY29wZSBjYWxsYmFjayBvciBvcHRpb25zIGZvciB0aGUgcmVsYXRpb25zaGlwLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW29wdGlvbnNdIFRoZSBvcHRpb25zIGZvciB0aGUgcmVsYXRpb25zaGlwIChlLmcuIHtjbGFzc05hbWU6IFwiUG9zdFwifSlcbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIGhhc01hbnkocmVsYXRpb25zaGlwTmFtZSwgc2NvcGVPck9wdGlvbnMsIG9wdGlvbnMpIHtcbiAgICBjb25zdCB7c2NvcGUsIHJlbGF0aW9uc2hpcE9wdGlvbnN9ID0gdGhpcy5fbm9ybWFsaXplUmVsYXRpb25zaGlwQXJncyhzY29wZU9yT3B0aW9ucywgb3B0aW9ucylcblxuICAgIHJldHVybiB0aGlzLl9kZWZpbmVSZWxhdGlvbnNoaXAocmVsYXRpb25zaGlwTmFtZSwgT2JqZWN0LmFzc2lnbih7dHlwZTogXCJoYXNNYW55XCIsIHNjb3BlfSwgcmVsYXRpb25zaGlwT3B0aW9ucykpXG4gIH1cblxuICAvKipcbiAgICogUmFpbHMtc3R5bGUgZGVjbGFyYXRpb24gdGhhdCB0aGlzIG1vZGVsIGFjY2VwdHMgbmVzdGVkLWF0dHJpYnV0ZSB3cml0ZXNcbiAgICogZm9yIGEgcmVsYXRpb25zaGlwIHdoZW4gc2F2ZWQgdGhyb3VnaCBhIHBhcmVudC4gUmVxdWlyZWQg4oCUIFZlbG9jaW91c1xuICAgKiB3aWxsIHJlZnVzZSBuZXN0ZWQgd3JpdGVzIGZvciBhbnkgcmVsYXRpb25zaGlwIG5vdCBsaXN0ZWQgaGVyZSwgZXZlblxuICAgKiBpZiBhIGZyb250ZW5kLW1vZGVsIHJlc291cmNlIHBlcm1pdHMgdGhlbS5cbiAgICpcbiAgICogT3B0aW9uczpcbiAgICogICAtIGFsbG93RGVzdHJveTogd2hldGhlciBgX2Rlc3Ryb3k6IHRydWVgIGVudHJpZXMgYXJlIGFsbG93ZWQuIERlZmF1bHQgZmFsc2UuXG4gICAqICAgLSBsaW1pdDogb3B0aW9uYWwgdXBwZXIgYm91bmQgb24gdGhlIG51bWJlciBvZiBuZXN0ZWQgZW50cmllcyBwZXIgcmVxdWVzdC5cbiAgICogICAtIHJlamVjdElmOiBvcHRpb25hbCBwcmVkaWNhdGUgYChhdHRyaWJ1dGVzKSA9PiBib29sZWFuYCB0aGF0IHNpbGVudGx5IHNraXBzIGVudHJpZXMuXG4gICAqXG4gICAqIFVzYWdlOlxuICAgKiAgIGNsYXNzIFByb2plY3QgZXh0ZW5kcyBSZWNvcmQge31cbiAgICogICBQcm9qZWN0Lmhhc01hbnkoXCJ0YXNrc1wiKVxuICAgKiAgIFByb2plY3QuYWNjZXB0c05lc3RlZEF0dHJpYnV0ZXNGb3IoXCJ0YXNrc1wiLCB7YWxsb3dEZXN0cm95OiB0cnVlfSlcbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZSBvbiB0aGlzIG1vZGVsLlxuICAgKiBAcGFyYW0ge3thbGxvd0Rlc3Ryb3k/OiBib29sZWFuLCBsaW1pdD86IG51bWJlciwgcmVqZWN0SWY/OiAoYXR0cmlidXRlczogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBib29sZWFufX0gW29wdGlvbnNdIC0gUG9saWN5IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIGFjY2VwdHNOZXN0ZWRBdHRyaWJ1dGVzRm9yKHJlbGF0aW9uc2hpcE5hbWUsIG9wdGlvbnMgPSB7fSkge1xuICAgIGlmICghcmVsYXRpb25zaGlwTmFtZSB8fCB0eXBlb2YgcmVsYXRpb25zaGlwTmFtZSAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHJlbGF0aW9uc2hpcE5hbWUgcGFzc2VkIHRvIGFjY2VwdHNOZXN0ZWRBdHRyaWJ1dGVzRm9yOiAke3JlbGF0aW9uc2hpcE5hbWV9YClcbiAgICB9XG5cbiAgICBpZiAoIU9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbCh0aGlzLCBcIl9hY2NlcHRlZE5lc3RlZEF0dHJpYnV0ZXNcIikpIHtcbiAgICAgIC8qKlxuICAgICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIHthbGxvd0Rlc3Ryb3k/OiBib29sZWFuLCBsaW1pdD86IG51bWJlciwgcmVqZWN0SWY/OiAoYXR0cmlidXRlczogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBib29sZWFufT59ICovXG4gICAgICB0aGlzLl9hY2NlcHRlZE5lc3RlZEF0dHJpYnV0ZXMgPSB7fVxuICAgIH1cblxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywge2FsbG93RGVzdHJveT86IGJvb2xlYW4sIGxpbWl0PzogbnVtYmVyLCByZWplY3RJZj86IChhdHRyaWJ1dGVzOiBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IGJvb2xlYW59Pn0gKi8gKHRoaXMuX2FjY2VwdGVkTmVzdGVkQXR0cmlidXRlcylbcmVsYXRpb25zaGlwTmFtZV0gPSB7Li4ub3B0aW9uc31cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFjY2VwdGVkIG5lc3RlZCBhdHRyaWJ1dGVzIGZvci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHJldHVybnMge3thbGxvd0Rlc3Ryb3k/OiBib29sZWFuLCBsaW1pdD86IG51bWJlciwgcmVqZWN0SWY/OiAoYXR0cmlidXRlczogUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+KSA9PiBib29sZWFufSB8IG51bGx9IC0gUG9saWN5IGRlY2xhcmVkIHZpYSBgYWNjZXB0c05lc3RlZEF0dHJpYnV0ZXNGb3JgLCBvciBudWxsIHdoZW4gbm90IGFjY2VwdGVkLlxuICAgKi9cbiAgc3RhdGljIGFjY2VwdGVkTmVzdGVkQXR0cmlidXRlc0ZvcihyZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMuX2FjY2VwdGVkTmVzdGVkQXR0cmlidXRlcz8uW3JlbGF0aW9uc2hpcE5hbWVdIHx8IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBBZGRzIGEgaGFzLW9uZS1yZWxhdGlvbnNoaXAgdG8gdGhlIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSBUaGUgbmFtZSBvZiB0aGUgcmVsYXRpb25zaGlwIChlLmcuIFwicG9zdFwiKVxuICAgKiBAcGFyYW0ge1JlbGF0aW9uc2hpcFNjb3BlQ2FsbGJhY2sgfCBvYmplY3R9IFtzY29wZU9yT3B0aW9uc10gVGhlIHNjb3BlIGNhbGxiYWNrIG9yIG9wdGlvbnMgZm9yIHRoZSByZWxhdGlvbnNoaXAuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBbb3B0aW9uc10gVGhlIG9wdGlvbnMgZm9yIHRoZSByZWxhdGlvbnNoaXAgKGUuZy4ge2NsYXNzTmFtZTogXCJQb3N0XCJ9KVxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgaGFzT25lKHJlbGF0aW9uc2hpcE5hbWUsIHNjb3BlT3JPcHRpb25zLCBvcHRpb25zKSB7XG4gICAgY29uc3Qge3Njb3BlLCByZWxhdGlvbnNoaXBPcHRpb25zfSA9IHRoaXMuX25vcm1hbGl6ZVJlbGF0aW9uc2hpcEFyZ3Moc2NvcGVPck9wdGlvbnMsIG9wdGlvbnMpXG5cbiAgICByZXR1cm4gdGhpcy5fZGVmaW5lUmVsYXRpb25zaGlwKHJlbGF0aW9uc2hpcE5hbWUsIE9iamVjdC5hc3NpZ24oe3R5cGU6IFwiaGFzT25lXCIsIHNjb3BlfSwgcmVsYXRpb25zaGlwT3B0aW9ucykpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWZpbmUgYXR0YWNobWVudC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dGFjaG1lbnROYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEF0dGFjaG1lbnQgYXJncy5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBBdHRhY2htZW50RHJpdmVyQ29uc3RydWN0b3IgfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IFthcmdzLmRyaXZlcl0gLSBBdHRhY2htZW50IGRyaXZlciBuYW1lLCBjbGFzcywgb3IgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7QXR0YWNobWVudFN5bmNDb25maWd1cmF0aW9ufSBbYXJncy5zeW5jXSAtIENsaWVudC1zYWZlIHN5bmNocm9uaXplZCBhc3NldCBwb2xpY3kuXG4gICAqIEBwYXJhbSB7XCJoYXNPbmVcIiB8IFwiaGFzTWFueVwifSBhcmdzLnR5cGUgLSBBdHRhY2htZW50IHR5cGUuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBfZGVmaW5lQXR0YWNobWVudChhdHRhY2htZW50TmFtZSwge2RyaXZlciwgc3luYywgdHlwZX0pIHtcbiAgICBpZiAoIWF0dGFjaG1lbnROYW1lIHx8IHR5cGVvZiBhdHRhY2htZW50TmFtZSAhPT0gXCJzdHJpbmdcIikgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGF0dGFjaG1lbnQgbmFtZTogJHthdHRhY2htZW50TmFtZX1gKVxuICAgIGlmIChhdHRhY2htZW50TmFtZSBpbiB0aGlzLmdldEF0dGFjaG1lbnRzTWFwKCkpIHRocm93IG5ldyBFcnJvcihgQXR0YWNobWVudCAke2F0dGFjaG1lbnROYW1lfSBhbHJlYWR5IGV4aXN0c2ApXG5cbiAgICBpZiAoc3luYykge1xuICAgICAgY29uc3Qge2ZldGNoLCBvZmZsaW5lUmVxdWlyZW1lbnQsIHJldGVudGlvbiwgLi4ucmVzdFN5bmN9ID0gc3luY1xuXG4gICAgICByZXN0QXJnc0Vycm9yKHJlc3RTeW5jKVxuXG4gICAgICBpZiAoZmV0Y2ggIT09IFwiZWFnZXJcIiAmJiBmZXRjaCAhPT0gXCJvbi1kZW1hbmRcIikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEF0dGFjaG1lbnQgJHthdHRhY2htZW50TmFtZX0gc3luYyBmZXRjaCBtdXN0IGJlIGVhZ2VyIG9yIG9uLWRlbWFuZGApXG4gICAgICB9XG4gICAgICBpZiAob2ZmbGluZVJlcXVpcmVtZW50ICE9PSBcIm9wdGlvbmFsXCIgJiYgb2ZmbGluZVJlcXVpcmVtZW50ICE9PSBcInJlcXVpcmVkXCIpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBBdHRhY2htZW50ICR7YXR0YWNobWVudE5hbWV9IG9mZmxpbmUgcmVxdWlyZW1lbnQgbXVzdCBiZSBvcHRpb25hbCBvciByZXF1aXJlZGApXG4gICAgICB9XG4gICAgICBpZiAocmV0ZW50aW9uICE9PSBcImR1cmFibGVcIiAmJiByZXRlbnRpb24gIT09IFwiZXZpY3RhYmxlXCIpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBBdHRhY2htZW50ICR7YXR0YWNobWVudE5hbWV9IHN5bmMgcmV0ZW50aW9uIG11c3QgYmUgZHVyYWJsZSBvciBldmljdGFibGVgKVxuICAgICAgfVxuICAgICAgaWYgKG9mZmxpbmVSZXF1aXJlbWVudCA9PT0gXCJyZXF1aXJlZFwiICYmIHJldGVudGlvbiAhPT0gXCJkdXJhYmxlXCIpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBBdHRhY2htZW50ICR7YXR0YWNobWVudE5hbWV9IHJlcXVpcmVkIG9mZmxpbmUgYXNzZXRzIG11c3QgdXNlIGR1cmFibGUgcmV0ZW50aW9uYClcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLmdldEF0dGFjaG1lbnRzTWFwKClbYXR0YWNobWVudE5hbWVdID0ge2RyaXZlciwgc3luYywgdHlwZX1cblxuICAgIGNvbnN0IHByb3RvdHlwZSA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMucHJvdG90eXBlKSlcblxuICAgIHByb3RvdHlwZVthdHRhY2htZW50TmFtZV0gPSBmdW5jdGlvbigpIHtcbiAgICAgIHJldHVybiB0aGlzLmdldEF0dGFjaG1lbnRCeU5hbWUoYXR0YWNobWVudE5hbWUpXG4gICAgfVxuXG4gICAgICBwcm90b3R5cGVbYHNldCR7aW5mbGVjdGlvbi5jYW1lbGl6ZShhdHRhY2htZW50TmFtZSl9YF0gPSBmdW5jdGlvbigvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyBuZXdWYWx1ZSkge1xuICAgICAgdGhpcy5nZXRBdHRhY2htZW50QnlOYW1lKGF0dGFjaG1lbnROYW1lKS5xdWV1ZUF0dGFjaChuZXdWYWx1ZSlcbiAgICAgIHJldHVybiBuZXdWYWx1ZVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBBZGRzIGEgc2luZ2xlIGF0dGFjaG1lbnQgaGVscGVyIHRvIHRoZSBtb2RlbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dGFjaG1lbnROYW1lIC0gQXR0YWNobWVudCBuYW1lLlxuICAgKiBAcGFyYW0ge3tkcml2ZXI/OiBzdHJpbmcgfCBBdHRhY2htZW50RHJpdmVyQ29uc3RydWN0b3IgfCBSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIHN5bmM/OiBBdHRhY2htZW50U3luY0NvbmZpZ3VyYXRpb259fSBbYXJnc10gLSBBdHRhY2htZW50IG9wdGlvbnMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBoYXNPbmVBdHRhY2htZW50KGF0dGFjaG1lbnROYW1lLCBhcmdzID0ge30pIHtcbiAgICB0aGlzLl9kZWZpbmVBdHRhY2htZW50KGF0dGFjaG1lbnROYW1lLCB7ZHJpdmVyOiBhcmdzLmRyaXZlciwgc3luYzogYXJncy5zeW5jLCB0eXBlOiBcImhhc09uZVwifSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBZGRzIGEgY29sbGVjdGlvbiBhdHRhY2htZW50IGhlbHBlciB0byB0aGUgbW9kZWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRhY2htZW50TmFtZSAtIEF0dGFjaG1lbnQgbmFtZS5cbiAgICogQHBhcmFtIHt7ZHJpdmVyPzogc3RyaW5nIHwgQXR0YWNobWVudERyaXZlckNvbnN0cnVjdG9yIHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+LCBzeW5jPzogQXR0YWNobWVudFN5bmNDb25maWd1cmF0aW9ufX0gW2FyZ3NdIC0gQXR0YWNobWVudCBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgaGFzTWFueUF0dGFjaG1lbnRzKGF0dGFjaG1lbnROYW1lLCBhcmdzID0ge30pIHtcbiAgICB0aGlzLl9kZWZpbmVBdHRhY2htZW50KGF0dGFjaG1lbnROYW1lLCB7ZHJpdmVyOiBhcmdzLmRyaXZlciwgc3luYzogYXJncy5zeW5jLCB0eXBlOiBcImhhc01hbnlcIn0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBodW1hbiBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgaHVtYW4gYXR0cmlidXRlIG5hbWUuXG4gICAqL1xuICBzdGF0aWMgaHVtYW5BdHRyaWJ1dGVOYW1lKGF0dHJpYnV0ZU5hbWUpIHtcbiAgICBjb25zdCBtb2RlbE5hbWVLZXkgPSBpbmZsZWN0aW9uLnVuZGVyc2NvcmUodGhpcy5nZXRNb2RlbE5hbWUoKSlcblxuICAgIHJldHVybiB0aGlzLl9nZXRDb25maWd1cmF0aW9uKCkuZ2V0VHJhbnNsYXRvcigpKGB2ZWxvY2lvdXMuZGF0YWJhc2UucmVjb3JkLmF0dHJpYnV0ZXMuJHttb2RlbE5hbWVLZXl9LiR7YXR0cmlidXRlTmFtZX1gLCB7ZGVmYXVsdFZhbHVlOiBpbmZsZWN0aW9uLmNhbWVsaXplKGF0dHJpYnV0ZU5hbWUpfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBkYXRhYmFzZSB0eXBlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBkYXRhYmFzZSB0eXBlLlxuICAgKi9cbiAgc3RhdGljIGdldERhdGFiYXNlVHlwZSgpIHtcbiAgICBpZiAoIXRoaXMuX2RhdGFiYXNlVHlwZSkgdGhyb3cgbmV3IEVycm9yKFwiRGF0YWJhc2UgdHlwZSBoYXNuJ3QgYmVlbiBzZXRcIilcblxuICAgIHJldHVybiB0aGlzLl9kYXRhYmFzZVR5cGVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBlYWdlciBsb2FkIHJlY29yZCBtZXRhZGF0YS5cbiAgICogQHBhcmFtIHtib29sZWFufSBlYWdlckxvYWRSZWNvcmRNZXRhZGF0YSAtIFdoZXRoZXIgcmVxdWlyZS1jb250ZXh0IGluaXRpYWxpemF0aW9uIHNob3VsZCBsb2FkIHRhYmxlIG1ldGFkYXRhIGZvciB0aGlzIG1vZGVsLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgc2V0RWFnZXJMb2FkUmVjb3JkTWV0YWRhdGEoZWFnZXJMb2FkUmVjb3JkTWV0YWRhdGEpIHtcbiAgICB0aGlzLl9lYWdlckxvYWRSZWNvcmRNZXRhZGF0YSA9IGVhZ2VyTG9hZFJlY29yZE1ldGFkYXRhXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZWFnZXIgbG9hZCByZWNvcmQgbWV0YWRhdGEuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgcmVxdWlyZS1jb250ZXh0IGluaXRpYWxpemF0aW9uIHNob3VsZCBsb2FkIHRhYmxlIG1ldGFkYXRhIGZvciB0aGlzIG1vZGVsLlxuICAgKi9cbiAgc3RhdGljIGdldEVhZ2VyTG9hZFJlY29yZE1ldGFkYXRhKCkge1xuICAgIGlmICh0aGlzLl9lYWdlckxvYWRSZWNvcmRNZXRhZGF0YSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdHJ1ZVxuXG4gICAgcmV0dXJuIHRoaXMuX2VhZ2VyTG9hZFJlY29yZE1ldGFkYXRhXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNldCByZWNvcmQgbWV0YWRhdGEuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyByZXNldFJlY29yZE1ldGFkYXRhKCkge1xuICAgIHRoaXMuX2luaXRpYWxpemVkID0gZmFsc2VcbiAgICB0aGlzLl9pbml0aWFsaXplUmVjb3JkUHJvbWlzZSA9IG51bGxcbiAgICB0aGlzLl9kYXRhYmFzZVR5cGUgPSB1bmRlZmluZWRcbiAgICB0aGlzLl90YWJsZSA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX2NvbHVtbnMgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9jb2x1bW5zQXNIYXNoID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fY29sdW1uTmFtZXMgPSB1bmRlZmluZWRcbiAgICB0aGlzLl9jb2x1bW5UeXBlQnlOYW1lID0gdW5kZWZpbmVkXG4gICAgdGhpcy5fYXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZSA9IHVuZGVmaW5lZFxuICAgIHRoaXMuX2NvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWUgPSB1bmRlZmluZWRcblxuICAgIGlmICghdGhpcy5fcmVjb3JkTWV0YWRhdGFNb2RlbENsYXNzKSB0aGlzLmNsZWFyUmVjb3JkTWV0YWRhdGFWYWx1ZXMoKVxuICB9XG5cbiAgLyoqXG4gICAqIFN0YXRpYyBmaWVsZHMgdGhhdCBiZWxvbmcgdG8gb25lIHBoeXNpY2FsIGRhdGFiYXNlL3NjaGVtYSBnZW5lcmF0aW9uLlxuICAgKiBAcmV0dXJucyB7U2V0PHN0cmluZz59IC0gTWV0YWRhdGEgcHJvcGVydHkgbmFtZXMuXG4gICAqL1xuICBzdGF0aWMgcmVjb3JkTWV0YWRhdGFQcm9wZXJ0eU5hbWVzKCkge1xuICAgIHJldHVybiByZWNvcmRNZXRhZGF0YVByb3BlcnR5TmFtZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyBvbmUgb3BlcmF0aW9uLWJvdW5kIG1ldGFkYXRhIGZpZWxkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWV0YWRhdGFLZXkgLSBQaHlzaWNhbCBkYXRhYmFzZSBhbmQgc2NoZW1hIGdlbmVyYXRpb24ga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcHJvcGVydHkgLSBTdGF0aWMgbWV0YWRhdGEgcHJvcGVydHkuXG4gICAqIEByZXR1cm5zIHtSZWNvcmRNZXRhZGF0YVZhbHVlfSAtIFN0b3JlZCBtZXRhZGF0YSB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyByZWNvcmRNZXRhZGF0YVZhbHVlKG1ldGFkYXRhS2V5LCBwcm9wZXJ0eSkge1xuICAgIHJldHVybiByZWNvcmRNZXRhZGF0YVZhbHVlc0Zvcih0aGlzKS5nZXQobWV0YWRhdGFLZXkpPy5nZXQocHJvcGVydHkpXG4gIH1cblxuICAvKipcbiAgICogV3JpdGVzIG9uZSBvcGVyYXRpb24tYm91bmQgbWV0YWRhdGEgZmllbGQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXRhZGF0YUtleSAtIFBoeXNpY2FsIGRhdGFiYXNlIGFuZCBzY2hlbWEgZ2VuZXJhdGlvbiBrZXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBwcm9wZXJ0eSAtIFN0YXRpYyBtZXRhZGF0YSBwcm9wZXJ0eS5cbiAgICogQHBhcmFtIHtSZWNvcmRNZXRhZGF0YVZhbHVlfSB2YWx1ZSAtIE1ldGFkYXRhIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIHN0YXRpYyBzZXRSZWNvcmRNZXRhZGF0YVZhbHVlKG1ldGFkYXRhS2V5LCBwcm9wZXJ0eSwgdmFsdWUpIHtcbiAgICBsZXQgdmFsdWVzID0gcmVjb3JkTWV0YWRhdGFWYWx1ZXNGb3IodGhpcykuZ2V0KG1ldGFkYXRhS2V5KVxuXG4gICAgaWYgKCF2YWx1ZXMpIHtcbiAgICAgIHZhbHVlcyA9IG5ldyBNYXAoKVxuICAgICAgcmVjb3JkTWV0YWRhdGFWYWx1ZXNGb3IodGhpcykuc2V0KG1ldGFkYXRhS2V5LCB2YWx1ZXMpXG4gICAgfVxuXG4gICAgdmFsdWVzLnNldChwcm9wZXJ0eSwgdmFsdWUpXG4gIH1cblxuICAvKiogQ2xlYXJzIGV2ZXJ5IHRlbmFudC9nZW5lcmF0aW9uIG1ldGFkYXRhIHNuYXBzaG90IGZvciB0aGlzIG1vZGVsLiAqL1xuICBzdGF0aWMgY2xlYXJSZWNvcmRNZXRhZGF0YVZhbHVlcygpIHtcbiAgICByZWNvcmRNZXRhZGF0YVZhbHVlc0J5TW9kZWwuZGVsZXRlKHRoaXMpXG4gIH1cblxuICAvKipcbiAgICogQ2xlYXJzIHNuYXBzaG90cyB3aG9zZSBrZXkgYmVsb25ncyB0byBvbmUgcGh5c2ljYWwgZGF0YWJhc2UgaWRlbnRpdHkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBkYXRhYmFzZUlkZW50aXR5IC0gTG9naWNhbCBpZGVudGlmaWVyIHBsdXMgcG9vbCByZXVzZSBrZXkuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgc3RhdGljIGNsZWFyUmVjb3JkTWV0YWRhdGFWYWx1ZXNGb3JEYXRhYmFzZUlkZW50aXR5KGRhdGFiYXNlSWRlbnRpdHkpIHtcbiAgICBjb25zdCB2YWx1ZXMgPSByZWNvcmRNZXRhZGF0YVZhbHVlc0J5TW9kZWwuZ2V0KHRoaXMpXG5cbiAgICBpZiAoIXZhbHVlcykgcmV0dXJuXG5cbiAgICBjb25zdCBtZXRhZGF0YVByZWZpeCA9IGAke2RhdGFiYXNlSWRlbnRpdHkubGVuZ3RofToke2RhdGFiYXNlSWRlbnRpdHl9OmBcblxuICAgIGZvciAoY29uc3QgbWV0YWRhdGFLZXkgb2YgdmFsdWVzLmtleXMoKSkge1xuICAgICAgaWYgKG1ldGFkYXRhS2V5LnN0YXJ0c1dpdGgobWV0YWRhdGFQcmVmaXgpKSB2YWx1ZXMuZGVsZXRlKG1ldGFkYXRhS2V5KVxuICAgIH1cblxuICAgIGlmICh2YWx1ZXMuc2l6ZSA9PT0gMCkgcmVjb3JkTWV0YWRhdGFWYWx1ZXNCeU1vZGVsLmRlbGV0ZSh0aGlzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyB0aGUgbW9kZWwgY2xhc3Mgd2l0aCBhIGNvbmZpZ3VyYXRpb24gd2l0aG91dCBsb2FkaW5nIHRhYmxlIG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gYXJncy5jb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIHJlZ2lzdGVyUmVjb3JkQ2xhc3Moe2NvbmZpZ3VyYXRpb24sIC4uLnJlc3RBcmdzfSkge1xuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihgTm8gY29uZmlndXJhdGlvbiBnaXZlbiBmb3IgJHt0aGlzLm5hbWV9YClcblxuICAgIHRoaXMucmVzZXRSZWNvcmRNZXRhZGF0YSgpXG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IHRoaXMuX3JlY29yZE1ldGFkYXRhTW9kZWxDbGFzcyB8fCB0aGlzXG5cbiAgICBtb2RlbENsYXNzLl9jb25maWd1cmF0aW9uID0gY29uZmlndXJhdGlvblxuICAgIGNvbmZpZ3VyYXRpb24ucmVnaXN0ZXJNb2RlbENsYXNzKG1vZGVsQ2xhc3MpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpbml0aWFsaXplIHJlY29yZC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IGFyZ3MuY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IFthcmdzLmNvbm5lY3Rpb25dIC0gRXhwbGljaXQgbWV0YWRhdGEgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBpbml0aWFsaXplUmVjb3JkKHtjb25maWd1cmF0aW9uLCBjb25uZWN0aW9uOiBleHBsaWNpdENvbm5lY3Rpb24sIC4uLnJlc3RBcmdzfSkge1xuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICBpZiAoIWNvbmZpZ3VyYXRpb24pIHRocm93IG5ldyBFcnJvcihgTm8gY29uZmlndXJhdGlvbiBnaXZlbiBmb3IgJHt0aGlzLm5hbWV9YClcblxuICAgIHRoaXMucmVnaXN0ZXJSZWNvcmRDbGFzcyh7Y29uZmlndXJhdGlvbn0pXG4gICAgY29uc3QgY29ubmVjdGlvbiA9IGV4cGxpY2l0Q29ubmVjdGlvbiB8fCB0aGlzLmNvbm5lY3Rpb24oe2VuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlOiBmYWxzZX0pXG5cbiAgICB0aGlzLl9kYXRhYmFzZVR5cGUgPSBjb25uZWN0aW9uLmdldFR5cGUoKVxuXG4gICAgdGhpcy5fdGFibGUgPSBhd2FpdCBjb25uZWN0aW9uLmdldFRhYmxlQnlOYW1lKHRoaXMudGFibGVOYW1lKCkpXG4gICAgdGhpcy5fY29sdW1ucyA9IGF3YWl0IHRoaXMuX2dldFRhYmxlKCkuZ2V0Q29sdW1ucygpXG5cbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS1jb2x1bW4uanNcIikuZGVmYXVsdD59ICovXG4gICAgdGhpcy5fY29sdW1uc0FzSGFzaCA9IHt9XG5cbiAgICBjb25zdCBjb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lID0gdGhpcy5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKClcbiAgICBjb25zdCBhdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lID0gdGhpcy5nZXRBdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lTWFwKClcbiAgICBjb25zdCBwcm90b3R5cGUgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzLnByb3RvdHlwZSkpXG5cbiAgICBmb3IgKGNvbnN0IGNvbHVtbiBvZiB0aGlzLl9jb2x1bW5zKSB7XG4gICAgICB0aGlzLl9jb2x1bW5zQXNIYXNoW2NvbHVtbi5nZXROYW1lKCldID0gY29sdW1uXG5cbiAgICAgIGNvbnN0IGRlYnVycmVkQ29sdW1uTmFtZSA9IGRlYnVyckNvbHVtbk5hbWUoY29sdW1uLmdldE5hbWUoKSlcbiAgICAgIGNvbnN0IGNhbWVsaXplZENvbHVtbk5hbWUgPSBpbmZsZWN0aW9uLmNhbWVsaXplKGRlYnVycmVkQ29sdW1uTmFtZSwgdHJ1ZSlcbiAgICAgIGNvbnN0IGNhbWVsaXplZENvbHVtbk5hbWVCaWdGaXJzdCA9IGluZmxlY3Rpb24uY2FtZWxpemUoZGVidXJyZWRDb2x1bW5OYW1lKVxuXG4gICAgICBhdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lW2NhbWVsaXplZENvbHVtbk5hbWVdID0gY29sdW1uLmdldE5hbWUoKVxuICAgICAgY29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZVtjb2x1bW4uZ2V0TmFtZSgpXSA9IGNhbWVsaXplZENvbHVtbk5hbWVcblxuICAgICAgaWYgKCEoY2FtZWxpemVkQ29sdW1uTmFtZSBpbiBwcm90b3R5cGUpKSB7XG4gICAgICAgIHByb3RvdHlwZVtjYW1lbGl6ZWRDb2x1bW5OYW1lXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHJldHVybiB0aGlzLnJlYWRBdHRyaWJ1dGUoY2FtZWxpemVkQ29sdW1uTmFtZSlcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAoIShgc2V0JHtjYW1lbGl6ZWRDb2x1bW5OYW1lQmlnRmlyc3R9YCBpbiBwcm90b3R5cGUpKSB7XG4gICAgICAgIHByb3RvdHlwZVtgc2V0JHtjYW1lbGl6ZWRDb2x1bW5OYW1lQmlnRmlyc3R9YF0gPSBmdW5jdGlvbigvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyBuZXdWYWx1ZSkge1xuICAgICAgICAgIHJldHVybiB0aGlzLl9zZXRDb2x1bW5BdHRyaWJ1dGUoY2FtZWxpemVkQ29sdW1uTmFtZSwgbmV3VmFsdWUpXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKCEoYGhhcyR7Y2FtZWxpemVkQ29sdW1uTmFtZUJpZ0ZpcnN0fWAgaW4gcHJvdG90eXBlKSkge1xuICAgICAgICBwcm90b3R5cGVbYGhhcyR7Y2FtZWxpemVkQ29sdW1uTmFtZUJpZ0ZpcnN0fWBdID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgY29uc3QgZHluYW1pY1RoaXMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsICguLi5hcmdzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4pID0+IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSlcbiAgICAgICAgICBjb25zdCB2YWx1ZSA9IGR5bmFtaWNUaGlzW2NhbWVsaXplZENvbHVtbk5hbWVdKClcblxuICAgICAgICAgIHJldHVybiB0aGlzLl9oYXNBdHRyaWJ1dGUodmFsdWUpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLl9kZWZpbmVUcmFuc2xhdGlvbk1ldGhvZHMoY29ubmVjdGlvbilcbiAgICBhd2FpdCBpbml0aWFsaXplQXVkaXRpbmcodGhpcylcbiAgICB0aGlzLl9pbml0aWFsaXplZCA9IHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBJbml0aWFsaXplcyB0aGUgbW9kZWwgY2xhc3MgdGhlIGZpcnN0IHRpbWUgYW4gYXN5bmMgcmVjb3JkIEFQSSBuZWVkcyB0YWJsZVxuICAgKiBtZXRhZGF0YS4gQ29uY3VycmVudCBjYWxsZXJzIHNoYXJlIHRoZSBzYW1lIGluaXRpYWxpemF0aW9uIHByb21pc2UsIGFuZCBhXG4gICAqIGZhaWxlZCBpbml0aWFsaXphdGlvbiBjYW4gYmUgcmV0cmllZCBieSBhIGxhdGVyIGNhbGwuXG4gICAqIEBwYXJhbSB7e2NvbmZpZ3VyYXRpb24/OiBpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQsIGNvbm5lY3Rpb24/OiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH19IFthcmdzXSAtIE9wdGlvbmFsIGNvbmZpZ3VyYXRpb24gYW5kIGV4cGxpY2l0IG1ldGFkYXRhIGNvbm5lY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gdGhlIG1vZGVsIGNsYXNzIGlzIGluaXRpYWxpemVkLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGVuc3VyZUluaXRpYWxpemVkKGFyZ3MgPSB7fSkge1xuICAgIGNvbnN0IHtjb25maWd1cmF0aW9uLCBjb25uZWN0aW9uLCAuLi5yZXN0QXJnc30gPSBhcmdzXG5cbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuXG4gICAgaWYgKHRoaXMuX2luaXRpYWxpemVkKSByZXR1cm5cblxuICAgIGlmICh0aGlzLl9pbml0aWFsaXplUmVjb3JkUHJvbWlzZSkge1xuICAgICAgYXdhaXQgdGhpcy5faW5pdGlhbGl6ZVJlY29yZFByb21pc2VcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IHJlc29sdmVkQ29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb24gfHwgdGhpcy5fY29uZmlndXJhdGlvbiB8fCBDb25maWd1cmF0aW9uLmN1cnJlbnQoKVxuXG4gICAgY29uc3QgaW5pdGlhbGl6ZVJlY29yZFByb21pc2UgPSB0aGlzLmluaXRpYWxpemVSZWNvcmQoe2NvbmZpZ3VyYXRpb246IHJlc29sdmVkQ29uZmlndXJhdGlvbiwgY29ubmVjdGlvbn0pXG5cbiAgICB0aGlzLl9pbml0aWFsaXplUmVjb3JkUHJvbWlzZSA9IGluaXRpYWxpemVSZWNvcmRQcm9taXNlXG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgaW5pdGlhbGl6ZVJlY29yZFByb21pc2VcbiAgICB9IGZpbmFsbHkge1xuICAgICAgaWYgKHRoaXMuX2luaXRpYWxpemVSZWNvcmRQcm9taXNlID09PSBpbml0aWFsaXplUmVjb3JkUHJvbWlzZSkge1xuICAgICAgICB0aGlzLl9pbml0aWFsaXplUmVjb3JkUHJvbWlzZSA9IG51bGxcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYXMgYXR0cmlidXRlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIFZhbHVlIHRvIHVzZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBhdHRyaWJ1dGUuXG4gICAqL1xuICBfaGFzQXR0cmlidXRlKHZhbHVlKSB7XG4gICAgaWYgKHR5cGVvZiB2YWx1ZSA9PSBcInN0cmluZ1wiKSB7XG4gICAgICB2YWx1ZSA9IHZhbHVlLnRyaW0oKVxuICAgIH1cblxuICAgIGlmICh2YWx1ZSkge1xuICAgICAgcmV0dXJuIHRydWVcbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIGluaXRpYWxpemVkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGluaXRpYWxpemVkLlxuICAgKi9cbiAgc3RhdGljIGlzSW5pdGlhbGl6ZWQoKSB7XG4gICAgaWYgKHRoaXMuX2luaXRpYWxpemVkKSByZXR1cm4gdHJ1ZVxuXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBhc3NlcnQgaGFzIGJlZW4gaW5pdGlhbGl6ZWQuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBfYXNzZXJ0SGFzQmVlbkluaXRpYWxpemVkKCkge1xuICAgIGlmICh0aGlzLl9pbml0aWFsaXplZCkgcmV0dXJuXG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5uYW1lfSB1c2VkIGJlZm9yZSBpbml0aWFsaXphdGlvbi4gQ2FsbCAke3RoaXMubmFtZX0uaW5pdGlhbGl6ZVJlY29yZCguLi4pIG9yIGNvbmZpZ3VyYXRpb24uaW5pdGlhbGl6ZSgpLmApXG4gIH1cblxuICAvKipcbiAgICogRGVmaW5lcyB0cmFuc2xhdGlvbiBhY2Nlc3NvcnMgYW5kIGluaXRpYWxpemVzIHRoZSBnZW5lcmF0ZWQgdHJhbnNsYXRpb25cbiAgICogY2xhc3MgdGhyb3VnaCB0aGUgc2FtZSBtZXRhZGF0YSBjb25uZWN0aW9uIGFzIHRoZSB0cmFuc2xhdGVkIG1vZGVsLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBjb25uZWN0aW9uIC0gTWV0YWRhdGEgY29ubmVjdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiB0cmFuc2xhdGlvbiBtZXRhZGF0YSBpcyByZWFkeS5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBfZGVmaW5lVHJhbnNsYXRpb25NZXRob2RzKGNvbm5lY3Rpb24pIHtcbiAgICBpZiAodGhpcy5fdHJhbnNsYXRpb25zICYmIE9iamVjdC5rZXlzKHRoaXMuX3RyYW5zbGF0aW9ucykubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgbG9jYWxlcyA9IHRoaXMuX2dldENvbmZpZ3VyYXRpb24oKS5nZXRMb2NhbGVzKClcblxuICAgICAgaWYgKCFsb2NhbGVzKSB0aHJvdyBuZXcgRXJyb3IoXCJMb2NhbGVzIGhhc24ndCBiZWVuIHNldCBpbiB0aGUgY29uZmlndXJhdGlvblwiKVxuXG4gICAgICBjb25zdCBUcmFuc2xhdGlvbkNsYXNzID0gdGhpcy5nZXRUcmFuc2xhdGlvbkNsYXNzKClcbiAgICAgIGNvbnN0IEJvdW5kVHJhbnNsYXRpb25DbGFzcyA9IHRoaXMuX3JlY29yZE1ldGFkYXRhQmluZGVyID8gdGhpcy5fcmVjb3JkTWV0YWRhdGFCaW5kZXIoVHJhbnNsYXRpb25DbGFzcykgOiBUcmFuc2xhdGlvbkNsYXNzXG5cbiAgICAgIGF3YWl0IEJvdW5kVHJhbnNsYXRpb25DbGFzcy5pbml0aWFsaXplUmVjb3JkKHtcbiAgICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5fZ2V0Q29uZmlndXJhdGlvbigpLFxuICAgICAgICBjb25uZWN0aW9uXG4gICAgICB9KVxuXG4gICAgICBmb3IgKGNvbnN0IG5hbWUgaW4gdGhpcy5fdHJhbnNsYXRpb25zKSB7XG4gICAgICAgIGNvbnN0IG5hbWVDYW1lbGl6ZWQgPSBpbmZsZWN0aW9uLmNhbWVsaXplKG5hbWUpXG4gICAgICAgIGNvbnN0IHNldHRlck1ldGhvZE5hbWUgPSBgc2V0JHtuYW1lQ2FtZWxpemVkfWBcbiAgICAgICAgY29uc3QgcHJvdG90eXBlID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcy5wcm90b3R5cGUpKVxuXG4gICAgICAgIHByb3RvdHlwZVtuYW1lXSA9IGZ1bmN0aW9uIGdldFRyYW5zbGF0ZWRBdHRyaWJ1dGUoKSB7XG4gICAgICAgICAgY29uc3QgbG9jYWxlID0gdGhpcy5fZ2V0Q29uZmlndXJhdGlvbigpLmdldExvY2FsZSgpXG5cbiAgICAgICAgICByZXR1cm4gdGhpcy5fZ2V0VHJhbnNsYXRlZEF0dHJpYnV0ZVdpdGhGYWxsYmFjayhuYW1lLCBsb2NhbGUpXG4gICAgICAgIH1cblxuICAgICAgICBwcm90b3R5cGVbYGhhcyR7bmFtZUNhbWVsaXplZH1gXSA9IGZ1bmN0aW9uIGhhc1RyYW5zbGF0ZWRBdHRyaWJ1dGUoKSB7XG4gICAgICAgICAgY29uc3QgZHluYW1pY1RoaXMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSlcbiAgICAgICAgICBjb25zdCBjYW5kaWRhdGUgPSBkeW5hbWljVGhpc1tuYW1lXVxuXG4gICAgICAgICAgaWYgKHR5cGVvZiBjYW5kaWRhdGUgPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgICBjb25zdCB2YWx1ZSA9IGNhbmRpZGF0ZS5iaW5kKHRoaXMpKClcblxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2hhc0F0dHJpYnV0ZSh2YWx1ZSlcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBjYW5kaWRhdGUgdG8gYmUgYSBmdW5jdGlvbiBidXQgaXQgd2FzOiAke3R5cGVvZiBjYW5kaWRhdGV9YClcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBwcm90b3R5cGVbc2V0dGVyTWV0aG9kTmFtZV0gPSBmdW5jdGlvbiBzZXRUcmFuc2xhdGVkQXR0cmlidXRlKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovIG5ld1ZhbHVlKSB7XG4gICAgICAgICAgY29uc3QgbG9jYWxlID0gdGhpcy5fZ2V0Q29uZmlndXJhdGlvbigpLmdldExvY2FsZSgpXG5cbiAgICAgICAgICByZXR1cm4gdGhpcy5fc2V0VHJhbnNsYXRlZEF0dHJpYnV0ZShuYW1lLCBsb2NhbGUsIG5ld1ZhbHVlKVxuICAgICAgICB9XG5cbiAgICAgICAgZm9yIChjb25zdCBsb2NhbGUgb2YgbG9jYWxlcykge1xuICAgICAgICAgIGNvbnN0IGxvY2FsZUNhbWVsaXplZCA9IGluZmxlY3Rpb24uY2FtZWxpemUobG9jYWxlKVxuICAgICAgICAgIGNvbnN0IGdldHRlck1ldGhvZE5hbWVMb2NhbGl6ZWQgPSBgJHtuYW1lfSR7bG9jYWxlQ2FtZWxpemVkfWBcbiAgICAgICAgICBjb25zdCBzZXR0ZXJNZXRob2ROYW1lTG9jYWxpemVkID0gYCR7c2V0dGVyTWV0aG9kTmFtZX0ke2xvY2FsZUNhbWVsaXplZH1gXG4gICAgICAgICAgY29uc3QgaGFzTWV0aG9kTmFtZUxvY2FsaXplZCA9IGBoYXMke2luZmxlY3Rpb24uY2FtZWxpemUobmFtZSl9JHtsb2NhbGVDYW1lbGl6ZWR9YFxuXG4gICAgICAgICAgcHJvdG90eXBlW2dldHRlck1ldGhvZE5hbWVMb2NhbGl6ZWRdID0gZnVuY3Rpb24gZ2V0VHJhbnNsYXRlZEF0dHJpYnV0ZVdpdGhMb2NhbGUoKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fZ2V0VHJhbnNsYXRlZEF0dHJpYnV0ZShuYW1lLCBsb2NhbGUpXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcHJvdG90eXBlW3NldHRlck1ldGhvZE5hbWVMb2NhbGl6ZWRdID0gZnVuY3Rpb24gc2V0VHJhbnNsYXRlZEF0dHJpYnV0ZVdpdGhMb2NhbGUoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gbmV3VmFsdWUpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9zZXRUcmFuc2xhdGVkQXR0cmlidXRlKG5hbWUsIGxvY2FsZSwgbmV3VmFsdWUpXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcHJvdG90eXBlW2hhc01ldGhvZE5hbWVMb2NhbGl6ZWRdID0gZnVuY3Rpb24gaGFzVHJhbnNsYXRlZEF0dHJpYnV0ZSgpIHtcbiAgICAgICAgICAgIGNvbnN0IGR5bmFtaWNUaGlzID0gLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpXG4gICAgICAgICAgICBjb25zdCBjYW5kaWRhdGUgPSBkeW5hbWljVGhpc1tnZXR0ZXJNZXRob2ROYW1lTG9jYWxpemVkXVxuXG4gICAgICAgICAgICBpZiAodHlwZW9mIGNhbmRpZGF0ZSA9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgICAgICAgY29uc3QgdmFsdWUgPSBjYW5kaWRhdGUuYmluZCh0aGlzKSgpXG5cbiAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2hhc0F0dHJpYnV0ZSh2YWx1ZSlcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgRXhwZWN0ZWQgY2FuZGlkYXRlIHRvIGJlIGEgZnVuY3Rpb24gYnV0IGl0IHdhczogJHt0eXBlb2YgY2FuZGlkYXRlfWApXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGNvbmZpZ3VyZWQgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgY29uZmlndXJlZCBub24tdGVuYW50IGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqL1xuICBzdGF0aWMgZ2V0Q29uZmlndXJlZERhdGFiYXNlSWRlbnRpZmllcigpIHtcbiAgICByZXR1cm4gdGhpcy5fZGF0YWJhc2VJZGVudGlmaWVyIHx8IFwiZGVmYXVsdFwiXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MuZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGVdIC0gV2hldGhlciB0ZW5hbnQtc3dpdGNoZWQgbW9kZWxzIG11c3QgcmVzb2x2ZSBhIHRlbmFudCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge29iamVjdH0gW2FyZ3MudGVuYW50XSAtIEV4cGxpY2l0IHRlbmFudCBkZXNjcmlwdG9yIGluc3RlYWQgb2YgdGhlIGFtYmllbnQgdGVuYW50LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKi9cbiAgc3RhdGljIGdldERhdGFiYXNlSWRlbnRpZmllcih7ZW5mb3JjZVRlbmFudERhdGFiYXNlU2NvcGUgPSB0cnVlLCB0ZW5hbnQgPSBDdXJyZW50LnRlbmFudCgpLCAuLi5yZXN0QXJnc30gPSB7fSkge1xuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICBjb25zdCB0ZW5hbnREYXRhYmFzZUlkZW50aWZpZXIgPSB0aGlzLmdldFRlbmFudERhdGFiYXNlSWRlbnRpZmllcih0ZW5hbnQpXG5cbiAgICBpZiAodGVuYW50RGF0YWJhc2VJZGVudGlmaWVyKSB7XG4gICAgICBpZiAoXG4gICAgICAgIGVuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlICYmXG4gICAgICAgIHRoaXMuX2dldENvbmZpZ3VyYXRpb24oKS5nZXRFbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZXMoKSAmJlxuICAgICAgICAhdGhpcy5fZ2V0Q29uZmlndXJhdGlvbigpLmlzRGF0YWJhc2VJZGVudGlmaWVyQWN0aXZlKHRlbmFudERhdGFiYXNlSWRlbnRpZmllciwgdGVuYW50KVxuICAgICAgKSB7XG4gICAgICAgIHRocm93IG5ldyBUZW5hbnREYXRhYmFzZVNjb3BlRXJyb3IoXG4gICAgICAgICAgYCR7dGhpcy5nZXRNb2RlbE5hbWUoKX0gcmVzb2x2ZWQgdGVuYW50IGRhdGFiYXNlIGlkZW50aWZpZXIgJHtKU09OLnN0cmluZ2lmeSh0ZW5hbnREYXRhYmFzZUlkZW50aWZpZXIpfSBidXQgdGhhdCBkYXRhYmFzZSBpZGVudGlmaWVyIGlzIG5vdCBhY3RpdmUgZm9yIHRoZSBjdXJyZW50IHRlbmFudC4gV3JhcCB0aGUgbW9kZWwgcXVlcnkgaW4gY29uZmlndXJhdGlvbi5ydW5XaXRoVGVuYW50KC4uLikgb3Igc2V0IGVuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlczogZmFsc2UgdG8gYWxsb3cgbGVnYWN5IGZhbGxiYWNrIGJlaGF2aW9yLmAsXG4gICAgICAgICAge21vZGVsTmFtZTogdGhpcy5nZXRNb2RlbE5hbWUoKX1cbiAgICAgICAgKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gdGVuYW50RGF0YWJhc2VJZGVudGlmaWVyXG4gICAgfVxuXG4gICAgaWYgKGVuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlICYmIHRoaXMuX3RlbmFudERhdGFiYXNlSWRlbnRpZmllclJlc29sdmVyICYmIHRoaXMuX2dldENvbmZpZ3VyYXRpb24oKS5nZXRFbmZvcmNlVGVuYW50RGF0YWJhc2VTY29wZXMoKSkge1xuICAgICAgdGhyb3cgbmV3IFRlbmFudERhdGFiYXNlU2NvcGVFcnJvcihcbiAgICAgICAgYCR7dGhpcy5nZXRNb2RlbE5hbWUoKX0gaXMgY29uZmlndXJlZCB3aXRoIHN3aXRjaGVzVGVuYW50RGF0YWJhc2UoLi4uKSBidXQgbm8gdGVuYW50IGRhdGFiYXNlIGlkZW50aWZpZXIgcmVzb2x2ZWQgZm9yIHRoZSBjdXJyZW50IHRlbmFudC4gV3JhcCB0aGUgbW9kZWwgcXVlcnkgaW4gY29uZmlndXJhdGlvbi5ydW5XaXRoVGVuYW50KC4uLikgb3Igc2V0IGVuZm9yY2VUZW5hbnREYXRhYmFzZVNjb3BlczogZmFsc2UgdG8gYWxsb3cgbGVnYWN5IGZhbGxiYWNrIGJlaGF2aW9yLmAsXG4gICAgICAgIHttb2RlbE5hbWU6IHRoaXMuZ2V0TW9kZWxOYW1lKCl9XG4gICAgICApXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuZ2V0Q29uZmlndXJlZERhdGFiYXNlSWRlbnRpZmllcigpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRhdGFiYXNlSWRlbnRpZmllciAtIERhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyBzZXREYXRhYmFzZUlkZW50aWZpZXIoZGF0YWJhc2VJZGVudGlmaWVyKSB7XG4gICAgdGhpcy5fZGF0YWJhc2VJZGVudGlmaWVyID0gZGF0YWJhc2VJZGVudGlmaWVyXG4gIH1cblxuICAvKipcbiAgICogRGVjbGFyZXMgYSB0ZW5hbnQtYXdhcmUgZGF0YWJhc2UgaWRlbnRpZmllciByZXNvbHZlciBmb3IgdGhpcyBtb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCAoKGFyZ3M6IHttb2RlbENsYXNzOiB0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQsIHRlbmFudDogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCBudWxsIHwgdW5kZWZpbmVkfSkgPT4gc3RyaW5nIHwgdW5kZWZpbmVkKX0gZGF0YWJhc2VJZGVudGlmaWVyT3JSZXNvbHZlciAtIFN0YXRpYyBpZGVudGlmaWVyIG9yIHJlc29sdmVyLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgc3dpdGNoZXNUZW5hbnREYXRhYmFzZShkYXRhYmFzZUlkZW50aWZpZXJPclJlc29sdmVyKSB7XG4gICAgdGhpcy5fdGVuYW50RGF0YWJhc2VJZGVudGlmaWVyUmVzb2x2ZXIgPSBkYXRhYmFzZUlkZW50aWZpZXJPclJlc29sdmVyXG5cbiAgICBpZiAodGhpcy5fdHJhbnNsYXRpb25DbGFzcykge1xuICAgICAgY29uc3QgdHJhbnNsYXRlZE1vZGVsQ2xhc3MgPSB0aGlzXG5cbiAgICAgIHRoaXMuX3RyYW5zbGF0aW9uQ2xhc3Muc3dpdGNoZXNUZW5hbnREYXRhYmFzZSgoe3RlbmFudH0pID0+IHRyYW5zbGF0ZWRNb2RlbENsYXNzLmdldFRlbmFudERhdGFiYXNlSWRlbnRpZmllcih0ZW5hbnQpKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhcyB0ZW5hbnQgZGF0YWJhc2UgaWRlbnRpZmllciByZXNvbHZlci5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGlzIG1vZGVsIHJlc29sdmVzIGl0cyBkYXRhYmFzZSBmcm9tIHRoZSBjdXJyZW50IHRlbmFudC5cbiAgICovXG4gIHN0YXRpYyBoYXNUZW5hbnREYXRhYmFzZUlkZW50aWZpZXJSZXNvbHZlcigpIHtcbiAgICByZXR1cm4gQm9vbGVhbih0aGlzLl90ZW5hbnREYXRhYmFzZUlkZW50aWZpZXJSZXNvbHZlcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0ZW5hbnQgZGF0YWJhc2UgaWRlbnRpZmllci5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gW3RlbmFudF0gLSBUZW5hbnQgb3ZlcnJpZGUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gVGVuYW50LXNjb3BlZCBkYXRhYmFzZSBpZGVudGlmaWVyIHdoZW4gY29uZmlndXJlZC5cbiAgICovXG4gIHN0YXRpYyBnZXRUZW5hbnREYXRhYmFzZUlkZW50aWZpZXIodGVuYW50ID0gQ3VycmVudC50ZW5hbnQoKSkge1xuICAgIGNvbnN0IHRlbmFudERhdGFiYXNlSWRlbnRpZmllclJlc29sdmVyID0gdGhpcy5fdGVuYW50RGF0YWJhc2VJZGVudGlmaWVyUmVzb2x2ZXJcblxuICAgIGlmICghdGVuYW50RGF0YWJhc2VJZGVudGlmaWVyUmVzb2x2ZXIpIHtcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGlmICh0eXBlb2YgdGVuYW50RGF0YWJhc2VJZGVudGlmaWVyUmVzb2x2ZXIgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgcmV0dXJuIHRlbmFudERhdGFiYXNlSWRlbnRpZmllclJlc29sdmVyKHtcbiAgICAgICAgbW9kZWxDbGFzczogdGhpcyxcbiAgICAgICAgdGVuYW50XG4gICAgICB9KVxuICAgIH1cblxuICAgIHJldHVybiB0ZW5hbnREYXRhYmFzZUlkZW50aWZpZXJSZXNvbHZlclxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IGF0dHJpYnV0ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBOYW1lLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gVGhlIGF0dHJpYnV0ZS5cbiAgICovXG4gIGdldEF0dHJpYnV0ZShuYW1lKSB7XG4gICAgY29uc3QgY29sdW1uTmFtZSA9IGluZmxlY3Rpb24udW5kZXJzY29yZShuYW1lKVxuXG4gICAgaWYgKCF0aGlzLmlzTmV3UmVjb3JkKCkgJiYgIShjb2x1bW5OYW1lIGluIHRoaXMuX2F0dHJpYnV0ZXMpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfSMke25hbWV9IGF0dHJpYnV0ZSBoYXNuJ3QgYmVlbiBsb2FkZWQgeWV0IGluICR7T2JqZWN0LmtleXModGhpcy5fYXR0cmlidXRlcykuam9pbihcIiwgXCIpfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2F0dHJpYnV0ZXNbY29sdW1uTmFtZV1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBtb2RlbCBjbGFzcy5cbiAgICogQGFic3RyYWN0XG4gICAqIEByZXR1cm5zIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IC0gVGhlIG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgZ2V0TW9kZWxDbGFzcygpIHtcbiAgICBjb25zdCBtb2RlbENsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9ICovICh0aGlzLmNvbnN0cnVjdG9yKVxuXG4gICAgaWYgKHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uKSByZXR1cm4gdGhpcy5fZGF0YWJhc2VPcGVyYXRpb24ubW9kZWxDbGFzcyhtb2RlbENsYXNzKVxuXG4gICAgcmV0dXJuIG1vZGVsQ2xhc3NcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCBhdHRyaWJ1dGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTmFtZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gbmV3VmFsdWUgLSBOZXcgdmFsdWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNldEF0dHJpYnV0ZShuYW1lLCBuZXdWYWx1ZSkge1xuICAgIC8vIFJlc29sdmUgcmF3IGNvbHVtbiBuYW1lcyAoXCJWQV/DnGJBdHRyaWJ1dElEXCIsIFwiSVBcIikgYW5kIGNhc2luZyB2YXJpYW50cyAoXCJ2QUZ1bmt0aW9uSURcIikgdG8gdGhlXG4gICAgLy8gY2Fub25pY2FsIGF0dHJpYnV0ZSB0aGUgbW9kZWwgYmFzZSBnZW5lcmF0ZXMgaXRzIHNldHRlciBmcm9tIChzZXRWQVVlYmF0dHJpYnV0aWQsIHNldElwLCDigKYpLlxuICAgIGNvbnN0IGNhbm9uaWNhbE5hbWUgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5yZXNvbHZlQXR0cmlidXRlTmFtZShuYW1lKSA/PyBuYW1lXG4gICAgY29uc3QgcmVxdWVzdGVkU2V0dGVyTmFtZSA9IGBzZXQke2luZmxlY3Rpb24uY2FtZWxpemUoY2Fub25pY2FsTmFtZSl9YFxuICAgIGNvbnN0IHNldHRlck5hbWUgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5maW5kTWVtYmVyTmFtZUluc2Vuc2l0aXZlKHRoaXMsIHJlcXVlc3RlZFNldHRlck5hbWUpXG4gICAgY29uc3QgZHluYW1pY1RoaXMgPSAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsICh2YWx1ZTogUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4pID0+IHZvaWQ+fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKVxuXG4gICAgdGhpcy5nZXRNb2RlbENsYXNzKCkuX2Fzc2VydEhhc0JlZW5Jbml0aWFsaXplZCgpXG4gICAgaWYgKCF0aGlzLmdldE1vZGVsQ2xhc3MoKS5pc0luaXRpYWxpemVkKCkpIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9IG1vZGVsIGlzbid0IGluaXRpYWxpemVkIHlldGApXG4gICAgaWYgKCFzZXR0ZXJOYW1lKSB0aHJvdyBuZXcgRXJyb3IoYE5vIHN1Y2ggc2V0dGVyIG1ldGhvZDogJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9IyR7cmVxdWVzdGVkU2V0dGVyTmFtZX1gKVxuXG4gICAgZHluYW1pY1RoaXNbc2V0dGVyTmFtZV0obmV3VmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzZXQgY29sdW1uIGF0dHJpYnV0ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBOYW1lLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBuZXdWYWx1ZSAtIE5ldyB2YWx1ZS5cbiAgICovXG4gIF9zZXRDb2x1bW5BdHRyaWJ1dGUobmFtZSwgbmV3VmFsdWUpIHtcbiAgICB0aGlzLmdldE1vZGVsQ2xhc3MoKS5fYXNzZXJ0SGFzQmVlbkluaXRpYWxpemVkKClcbiAgICBpZiAoIXRoaXMuZ2V0TW9kZWxDbGFzcygpLl9hdHRyaWJ1dGVOYW1lVG9Db2x1bW5OYW1lKSB0aHJvdyBuZXcgRXJyb3IoXCJObyBhdHRyaWJ1dGUtdG8tY29sdW1uIG1hcHBpbmcuIEhhcyByZWNvcmQgYmVlbiBpbml0aWFsaXplZD9cIilcblxuICAgIGNvbnN0IHJlc29sdmVkTmFtZSA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLnJlc29sdmVBdHRyaWJ1dGVOYW1lKG5hbWUpXG4gICAgY29uc3QgY29sdW1uTmFtZSA9IHJlc29sdmVkTmFtZSA/IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldEF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXAoKVtyZXNvbHZlZE5hbWVdIDogdW5kZWZpbmVkXG5cbiAgICBpZiAoIWNvbHVtbk5hbWUpIHRocm93IG5ldyBFcnJvcihgQ291bGRuJ3QgZmlndXJlIG91dCBjb2x1bW4gbmFtZSBmb3IgYXR0cmlidXRlOiAke25hbWV9YClcblxuICAgIGxldCBub3JtYWxpemVkVmFsdWUgPSBuZXdWYWx1ZVxuICAgIGNvbnN0IGNvbHVtblR5cGUgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRDb2x1bW5UeXBlQnlOYW1lKGNvbHVtbk5hbWUpXG5cbiAgICBpZiAoY29sdW1uVHlwZSAmJiB0aGlzLmdldE1vZGVsQ2xhc3MoKS5faXNEYXRlTGlrZVR5cGUoY29sdW1uVHlwZSkpIHtcbiAgICAgIG5vcm1hbGl6ZWRWYWx1ZSA9IHRoaXMuX25vcm1hbGl6ZURhdGVWYWx1ZShuZXdWYWx1ZSlcbiAgICB9XG5cbiAgICBub3JtYWxpemVkVmFsdWUgPSB0aGlzLl9ub3JtYWxpemVCb29sZWFuVmFsdWVGb3JXcml0ZSh7YXR0cmlidXRlTmFtZTogbmFtZSwgY29sdW1uVHlwZSwgdmFsdWU6IG5vcm1hbGl6ZWRWYWx1ZX0pXG5cbiAgICBpZiAodGhpcy5fYXR0cmlidXRlc1tjb2x1bW5OYW1lXSAhPSBub3JtYWxpemVkVmFsdWUpIHtcbiAgICAgIHRoaXMuX2NsZWFyQmVsb25nc1RvUmVsYXRpb25zaGlwRm9yQ2hhbmdlZEZvcmVpZ25LZXkoY29sdW1uTmFtZSwgbm9ybWFsaXplZFZhbHVlKVxuICAgICAgdGhpcy5fY2hhbmdlc1tjb2x1bW5OYW1lXSA9IG5vcm1hbGl6ZWRWYWx1ZVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhcnMgbG9hZGVkIGJlbG9uZ3MtdG8gY2FjaGVzIHdoZW4gY2FsbGVycyBhc3NpZ24gdGhlIGZvcmVpZ24ga2V5IGRpcmVjdGx5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29sdW1uTmFtZSAtIENoYW5nZWQgZGF0YWJhc2UgY29sdW1uIG5hbWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IG5vcm1hbGl6ZWRWYWx1ZSAtIE5ldyBub3JtYWxpemVkIGNvbHVtbiB2YWx1ZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX2NsZWFyQmVsb25nc1RvUmVsYXRpb25zaGlwRm9yQ2hhbmdlZEZvcmVpZ25LZXkoY29sdW1uTmFtZSwgbm9ybWFsaXplZFZhbHVlKSB7XG4gICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXAgb2YgdGhpcy5fYmVsb25nc1RvUmVsYXRpb25zaGlwc0ZvckZvcmVpZ25LZXkoY29sdW1uTmFtZSkpIHtcbiAgICAgIGlmICh0aGlzLl9iZWxvbmdzVG9SZWxhdGlvbnNoaXBNYXRjaGVzRm9yZWlnbktleVZhbHVlKHtub3JtYWxpemVkVmFsdWUsIHJlbGF0aW9uc2hpcH0pKSBjb250aW51ZVxuXG4gICAgICB0aGlzLl9jbGVhckxvYWRlZEJlbG9uZ3NUb1JlbGF0aW9uc2hpcChyZWxhdGlvbnNoaXApXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYmVsb25ncyB0byByZWxhdGlvbnNoaXBzIGZvciBmb3JlaWduIGtleS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbHVtbk5hbWUgLSBDaGFuZ2VkIGRhdGFiYXNlIGNvbHVtbiBuYW1lLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIExvYWRlZCByZWxhdGlvbnNoaXAgaW5zdGFuY2VzIHRoYXQgdXNlIHRoZSBjaGFuZ2VkIGZvcmVpZ24ga2V5LlxuICAgKi9cbiAgX2JlbG9uZ3NUb1JlbGF0aW9uc2hpcHNGb3JGb3JlaWduS2V5KGNvbHVtbk5hbWUpIHtcbiAgICBpZiAoIXRoaXMuX2luc3RhbmNlUmVsYXRpb25zaGlwcykgcmV0dXJuIFtdXG5cbiAgICByZXR1cm4gT2JqZWN0XG4gICAgICAudmFsdWVzKHRoaXMuX2luc3RhbmNlUmVsYXRpb25zaGlwcylcbiAgICAgIC5maWx0ZXIoKHJlbGF0aW9uc2hpcCkgPT4gdGhpcy5fYmVsb25nc1RvUmVsYXRpb25zaGlwVXNlc0ZvcmVpZ25LZXkoe2NvbHVtbk5hbWUsIHJlbGF0aW9uc2hpcH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYmVsb25ncyB0byByZWxhdGlvbnNoaXAgdXNlcyBmb3JlaWduIGtleS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBSZWxhdGlvbnNoaXAgbWF0Y2ggYXJndW1lbnRzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jb2x1bW5OYW1lIC0gQ2hhbmdlZCBkYXRhYmFzZSBjb2x1bW4gbmFtZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5yZWxhdGlvbnNoaXAgLSBSZWxhdGlvbnNoaXAgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIHJlbGF0aW9uc2hpcCBpcyBhIGJlbG9uZ3MtdG8gdXNpbmcgdGhlIGNoYW5nZWQgZm9yZWlnbiBrZXkuXG4gICAqL1xuICBfYmVsb25nc1RvUmVsYXRpb25zaGlwVXNlc0ZvcmVpZ25LZXkoe2NvbHVtbk5hbWUsIHJlbGF0aW9uc2hpcH0pIHtcbiAgICBpZiAocmVsYXRpb25zaGlwLmdldFR5cGUoKSAhPSBcImJlbG9uZ3NUb1wiKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IGZvcmVpZ25LZXkgPSByZWxhdGlvbnNoaXAuZ2V0Rm9yZWlnbktleSgpXG4gICAgY29uc3QgZm9yZWlnbktleUF0dHJpYnV0ZSA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldENvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXAoKVtmb3JlaWduS2V5XVxuXG4gICAgcmV0dXJuIGZvcmVpZ25LZXkgPT0gY29sdW1uTmFtZSB8fCBmb3JlaWduS2V5QXR0cmlidXRlID09IGNvbHVtbk5hbWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGJlbG9uZ3MgdG8gcmVsYXRpb25zaGlwIG1hdGNoZXMgZm9yZWlnbiBrZXkgdmFsdWUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUmVsYXRpb25zaGlwIGNhY2hlIGFyZ3VtZW50cy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy5ub3JtYWxpemVkVmFsdWUgLSBOZXcgbm9ybWFsaXplZCBjb2x1bW4gdmFsdWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MucmVsYXRpb25zaGlwIC0gUmVsYXRpb25zaGlwIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSBsb2FkZWQgcmVsYXRlZCByZWNvcmQgc3RpbGwgbWF0Y2hlcyB0aGUgY2hhbmdlZCBmb3JlaWduIGtleS5cbiAgICovXG4gIF9iZWxvbmdzVG9SZWxhdGlvbnNoaXBNYXRjaGVzRm9yZWlnbktleVZhbHVlKHtub3JtYWxpemVkVmFsdWUsIHJlbGF0aW9uc2hpcH0pIHtcbiAgICBjb25zdCBsb2FkZWQgPSByZWxhdGlvbnNoaXAuZ2V0TG9hZGVkT3JVbmRlZmluZWQoKVxuXG4gICAgaWYgKCFsb2FkZWQpIHJldHVybiBmYWxzZVxuICAgIGlmIChBcnJheS5pc0FycmF5KGxvYWRlZCkpIHJldHVybiBmYWxzZVxuICAgIGlmICghcmVsYXRpb25zaGlwLmdldFRhcmdldE1vZGVsQ2xhc3MoKSkgcmV0dXJuIGZhbHNlXG5cbiAgICByZXR1cm4gbG9hZGVkLnJlYWRDb2x1bW4ocmVsYXRpb25zaGlwLmdldFByaW1hcnlLZXkoKSkgPT0gbm9ybWFsaXplZFZhbHVlXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0aGUgZm9yZWlnbiBrZXkgdmFsdWUgZm9yIGEgYmVsb25ncy10byByZWxhdGlvbnNoaXAgYXNzaWdubWVudC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBSZWxhdGlvbnNoaXAgYXNzaWdubWVudCBhcmd1bWVudHMuXG4gICAqIEBwYXJhbSB7VmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQgfCBudWxsIHwgdW5kZWZpbmVkfSBhcmdzLm1vZGVsIC0gQXNzaWduZWQgbW9kZWwuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9pbnN0YW5jZS1yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5yZWxhdGlvbnNoaXAgLSBCZWxvbmdzLXRvIHJlbGF0aW9uc2hpcCBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWR9IC0gRm9yZWlnbiBrZXkgdmFsdWUgZm9yIHRoZSBhc3NpZ25tZW50LlxuICAgKi9cbiAgX2JlbG9uZ3NUb0ZvcmVpZ25LZXlWYWx1ZSh7bW9kZWwsIHJlbGF0aW9uc2hpcH0pIHtcbiAgICBpZiAobW9kZWwgPT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgICBpZiAoIShtb2RlbCBpbnN0YW5jZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkKSkgdGhyb3cgbmV3IEVycm9yKGBVbmV4cGVjdGVkIG1vZGVsIHR5cGU6ICR7dHlwZW9mIG1vZGVsfWApXG5cbiAgICByZXR1cm4gLyoqIEB0eXBlIHtzdHJpbmcgfCBudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkfSAqLyAobW9kZWwucmVhZENvbHVtbihyZWxhdGlvbnNoaXAuZ2V0UHJpbWFyeUtleSgpKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNsZWFyIGxvYWRlZCBiZWxvbmdzIHRvIHJlbGF0aW9uc2hpcC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gcmVsYXRpb25zaGlwIC0gUmVsYXRpb25zaGlwIGluc3RhbmNlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfY2xlYXJMb2FkZWRCZWxvbmdzVG9SZWxhdGlvbnNoaXAocmVsYXRpb25zaGlwKSB7XG4gICAgcmVsYXRpb25zaGlwLnNldExvYWRlZCh1bmRlZmluZWQpXG4gICAgcmVsYXRpb25zaGlwLnNldFByZWxvYWRlZChmYWxzZSlcbiAgICByZWxhdGlvbnNoaXAuc2V0RGlydHkoZmFsc2UpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgZGF0ZSB2YWx1ZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBWYWx1ZSB0byB1c2UuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBUaGUgZGF0ZSB2YWx1ZS5cbiAgICovXG4gIF9ub3JtYWxpemVEYXRlVmFsdWUodmFsdWUpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplRGF0ZVZhbHVlRm9yV3JpdGUodmFsdWUsIHt0aW1lWm9uZTogdGhpcy5nZXRNb2RlbENsYXNzKCkuX3RpbWVab25lRm9yRGF0ZVdyaXRlKCl9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIHNxbGl0ZSBib29sZWFuIHZhbHVlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IHVuZGVmaW5lZH0gYXJncy5jb2x1bW5UeXBlIC0gQ29sdW1uIHR5cGUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MudmFsdWUgLSBWYWx1ZSB0byBub3JtYWxpemUuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBOb3JtYWxpemVkIHZhbHVlLlxuICAgKi9cbiAgX25vcm1hbGl6ZVNxbGl0ZUJvb2xlYW5WYWx1ZSh7Y29sdW1uVHlwZSwgdmFsdWV9KSB7XG4gICAgaWYgKHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldERhdGFiYXNlVHlwZSgpICE9IFwic3FsaXRlXCIpIHJldHVybiB2YWx1ZVxuICAgIGlmICghY29sdW1uVHlwZSkgcmV0dXJuIHZhbHVlXG4gICAgaWYgKGNvbHVtblR5cGUudG9Mb3dlckNhc2UoKSAhPT0gXCJib29sZWFuXCIpIHJldHVybiB2YWx1ZVxuICAgIGlmICh2YWx1ZSA9PT0gdHJ1ZSkgcmV0dXJuIDFcbiAgICBpZiAodmFsdWUgPT09IGZhbHNlKSByZXR1cm4gMFxuXG4gICAgcmV0dXJuIHZhbHVlXG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBhIGJvb2xlYW4gdmFsdWUgYmVmb3JlIHN0b3JpbmcuIEEgZGVjbGFyZWQgYFwiYm9vbGVhblwiYCBhdHRyaWJ1dGUgY2FzdCBzdG9yZXNcbiAgICogYm9vbGVhbnMgYXMgMS8wIG9ubHkgZm9yIGludGVnZXItYmFja2VkIGNvbHVtbnMgKGUuZy4gYW4gTVNTUUwgYGJpdGApLiBDb2x1bW5zIHdob3NlXG4gICAqIHVuZGVybHlpbmcgdHlwZSBpcyBhbHJlYWR5IGEgbmF0aXZlIGJvb2xlYW4gKGUuZy4gUG9zdGdyZXMgYGJvb2xlYW5gKSBrZWVwIGB0cnVlYC9gZmFsc2VgXG4gICAqIHNvIHRoZSBkcml2ZXIgY2FuIGVtaXQgdGhlIHByb3BlciBib29sZWFuIGxpdGVyYWw7IG90aGVyd2lzZSB0aGUgc3FsaXRlLW9ubHkgbm9ybWFsaXplciBhcHBsaWVzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5hdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUgYmVpbmcgd3JpdHRlbi5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IGFyZ3MuY29sdW1uVHlwZSAtIENvbHVtbiB0eXBlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnZhbHVlIC0gVmFsdWUgdG8gbm9ybWFsaXplLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gTm9ybWFsaXplZCB2YWx1ZS5cbiAgICovXG4gIF9ub3JtYWxpemVCb29sZWFuVmFsdWVGb3JXcml0ZSh7YXR0cmlidXRlTmFtZSwgY29sdW1uVHlwZSwgdmFsdWV9KSB7XG4gICAgaWYgKCF0aGlzLmdldE1vZGVsQ2xhc3MoKS5fZGVjbGFyZWRCb29sZWFuU3RvcmVzQXNJbnRlZ2VyKGF0dHJpYnV0ZU5hbWUpKSB7XG4gICAgICByZXR1cm4gdGhpcy5fbm9ybWFsaXplU3FsaXRlQm9vbGVhblZhbHVlKHtjb2x1bW5UeXBlLCB2YWx1ZX0pXG4gICAgfVxuXG4gICAgaWYgKHZhbHVlID09PSB0cnVlKSByZXR1cm4gMVxuICAgIGlmICh2YWx1ZSA9PT0gZmFsc2UpIHJldHVybiAwXG5cbiAgICByZXR1cm4gdmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBXaGV0aGVyIGEgZGVjbGFyZWQgYFwiYm9vbGVhblwiYCBhdHRyaWJ1dGUgY2FzdCBpcyBiYWNrZWQgYnkgYW4gaW50ZWdlciBjb2x1bW4gKGUuZy4gYW4gTVNTUUxcbiAgICogYGJpdGApLCBzbyBib29sZWFucyBtdXN0IGJlIHN0b3JlZCBhcyAxLzAuIEEgbmF0aXZlIGJvb2xlYW4gY29sdW1uIChlLmcuIFBvc3RncmVzIGBib29sZWFuYClcbiAgICogcmV0dXJucyBmYWxzZSBhbmQga2VlcHMgYHRydWVgL2BmYWxzZWAgZm9yIHRoZSBkcml2ZXIuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhlIGRlY2xhcmVkIGJvb2xlYW4gaXMgc3RvcmVkIGFzIGFuIGludGVnZXIuXG4gICAqL1xuICBzdGF0aWMgX2RlY2xhcmVkQm9vbGVhblN0b3Jlc0FzSW50ZWdlcihhdHRyaWJ1dGVOYW1lKSB7XG4gICAgaWYgKHRoaXMuZ2V0QXR0cmlidXRlQ2FzdChhdHRyaWJ1dGVOYW1lKSAhPT0gXCJib29sZWFuXCIpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3QgY29sdW1uTmFtZSA9IHRoaXMuZ2V0QXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCgpW2F0dHJpYnV0ZU5hbWVdXG4gICAgY29uc3QgaW50cm9zcGVjdGVkVHlwZSA9IGNvbHVtbk5hbWUgPyB0aGlzLmdldENvbHVtbnNIYXNoKClbY29sdW1uTmFtZV0/LmdldFR5cGUoKSA6IHVuZGVmaW5lZFxuXG4gICAgcmV0dXJuIHR5cGVvZiBpbnRyb3NwZWN0ZWRUeXBlID09PSBcInN0cmluZ1wiICYmIGludHJvc3BlY3RlZFR5cGUudG9Mb3dlckNhc2UoKSAhPT0gXCJib29sZWFuXCJcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjb2x1bW5zLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLWNvbHVtbi5qc1wiKS5kZWZhdWx0W119IC0gVGhlIGNvbHVtbnMuXG4gICAqL1xuICBzdGF0aWMgZ2V0Q29sdW1ucygpIHtcbiAgICB0aGlzLl9hc3NlcnRIYXNCZWVuSW5pdGlhbGl6ZWQoKVxuICAgIGlmICghdGhpcy5fY29sdW1ucykgdGhyb3cgbmV3IEVycm9yKGAke3RoaXMubmFtZX0gaGFzbid0IGJlZW4gaW5pdGlhbGl6ZWQgeWV0YClcblxuICAgIHJldHVybiB0aGlzLl9jb2x1bW5zXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY29sdW1ucyBoYXNoLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLWNvbHVtbi5qc1wiKS5kZWZhdWx0Pn0gLSBUaGUgY29sdW1ucyBoYXNoLlxuICAgKi9cbiAgc3RhdGljIGdldENvbHVtbnNIYXNoKCkge1xuICAgIGlmICghdGhpcy5fY29sdW1uc0FzSGFzaCkge1xuICAgICAgLyoqXG4gICAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgaW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLWNvbHVtbi5qc1wiKS5kZWZhdWx0Pn0gKi9cbiAgICAgIHRoaXMuX2NvbHVtbnNBc0hhc2ggPSB7fVxuXG4gICAgICBmb3IgKGNvbnN0IGNvbHVtbiBvZiB0aGlzLmdldENvbHVtbnMoKSkge1xuICAgICAgICB0aGlzLl9jb2x1bW5zQXNIYXNoW2NvbHVtbi5nZXROYW1lKCldID0gY29sdW1uXG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2NvbHVtbnNBc0hhc2hcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjb2x1bW4gdHlwZSBieSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIE5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gVGhlIGNvbHVtbiB0eXBlIGJ5IG5hbWUuXG4gICAqL1xuICBzdGF0aWMgZ2V0Q29sdW1uVHlwZUJ5TmFtZShuYW1lKSB7XG4gICAgaWYgKCF0aGlzLl9jb2x1bW5UeXBlQnlOYW1lKSB7XG4gICAgICAvKipcbiAgICAgICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCB1bmRlZmluZWQ+fSAqL1xuICAgICAgdGhpcy5fY29sdW1uVHlwZUJ5TmFtZSA9IHt9XG5cbiAgICAgIGZvciAoY29uc3QgY29sdW1uIG9mIHRoaXMuZ2V0Q29sdW1ucygpKSB7XG4gICAgICAgIHRoaXMuX2NvbHVtblR5cGVCeU5hbWVbY29sdW1uLmdldE5hbWUoKV0gPSBjb2x1bW4uZ2V0VHlwZSgpXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgYXR0cmlidXRlTmFtZSA9IHRoaXMuZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCgpW25hbWVdXG5cbiAgICBpZiAoYXR0cmlidXRlTmFtZSkge1xuICAgICAgY29uc3QgY2FzdCA9IHRoaXMuZ2V0QXR0cmlidXRlQ2FzdChhdHRyaWJ1dGVOYW1lKVxuXG4gICAgICBpZiAoY2FzdCkgcmV0dXJuIGNhc3RcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fY29sdW1uVHlwZUJ5TmFtZVtuYW1lXVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgZGF0ZSBsaWtlIHR5cGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0eXBlIC0gVHlwZSBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGRhdGUgbGlrZSB0eXBlLlxuICAgKi9cbiAgc3RhdGljIF9pc0RhdGVMaWtlVHlwZSh0eXBlKSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZFR5cGUgPSB0eXBlLnRvTG93ZXJDYXNlKClcblxuICAgIHJldHVybiBub3JtYWxpemVkVHlwZSA9PSBcImRhdGVcIiB8fFxuICAgICAgbm9ybWFsaXplZFR5cGUgPT0gXCJkYXRldGltZVwiIHx8XG4gICAgICBub3JtYWxpemVkVHlwZSA9PSBcInRpbWVzdGFtcFwiIHx8XG4gICAgICBub3JtYWxpemVkVHlwZSA9PSBcInRpbWVzdGFtcHR6XCIgfHxcbiAgICAgIG5vcm1hbGl6ZWRUeXBlLnN0YXJ0c1dpdGgoXCJ0aW1lc3RhbXAgXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgY29sdW1uIG5hbWVzLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8c3RyaW5nPn0gLSBUaGUgY29sdW1uIG5hbWVzLlxuICAgKi9cbiAgc3RhdGljIGdldENvbHVtbk5hbWVzKCkge1xuICAgIGlmICghdGhpcy5fY29sdW1uTmFtZXMpIHtcbiAgICAgIHRoaXMuX2NvbHVtbk5hbWVzID0gdGhpcy5nZXRDb2x1bW5zKCkubWFwKChjb2x1bW4pID0+IGNvbHVtbi5nZXROYW1lKCkpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX2NvbHVtbk5hbWVzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdGFibGUuXG4gICAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UtdGFibGUuanNcIikuZGVmYXVsdH0gLSBUaGUgdGFibGUuXG4gICAqL1xuICBzdGF0aWMgX2dldFRhYmxlKCkge1xuICAgIGlmICghdGhpcy5fdGFibGUpIHRocm93IG5ldyBFcnJvcihgJHt0aGlzLm5hbWV9IGhhc24ndCBiZWVuIGluaXRpYWxpemVkIHlldGApXG5cbiAgICByZXR1cm4gdGhpcy5fdGFibGVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGluc2VydCBtdWx0aXBsZS5cbiAgICogQHBhcmFtIHtBcnJheTxzdHJpbmc+fSBjb2x1bW5zIC0gQ29sdW1uIG5hbWVzLlxuICAgKiBAcGFyYW0ge0FycmF5PEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IHJvd3MgLSBSb3dzIHRvIGluc2VydC5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFthcmdzLmNhc3RdIC0gV2hldGhlciB0byBjYXN0IHZhbHVlcyBiYXNlZCBvbiBjb2x1bW4gdHlwZXMuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MucmV0cnlJbmRpdmlkdWFsbHlPbkZhaWx1cmVdIC0gUmV0cnkgcm93cyBpbmRpdmlkdWFsbHkgaWYgYSBiYXRjaCBpbnNlcnQgZmFpbHMuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MucmV0dXJuUmVzdWx0c10gLSBSZXR1cm4gc3VjY2VlZGVkL2ZhaWxlZCByb3dzIGluc3RlYWQgb2YgdGhyb3dpbmcgd2hlbiByZXRyaWVzIGZhaWwuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQgfCB7c3VjY2VlZGVkUm93czogQXJyYXk8QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+PiwgZmFpbGVkUm93czogQXJyYXk8QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+PiwgZXJyb3JzOiBBcnJheTx7cm93OiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIGVycm9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0+fT59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBpbnNlcnRNdWx0aXBsZShjb2x1bW5zLCByb3dzLCBhcmdzID0ge30pIHtcbiAgICBjb25zdCB7Y2FzdCA9IHRydWUsIHJldHJ5SW5kaXZpZHVhbGx5T25GYWlsdXJlID0gZmFsc2UsIHJldHVyblJlc3VsdHMgPSBmYWxzZSwgLi4ucmVzdEFyZ3N9ID0gYXJnc1xuXG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIGNvbnN0IG5vcm1hbGl6ZWRSb3dzID0gY2FzdFxuICAgICAgPyB0aGlzLl9ub3JtYWxpemVJbnNlcnRNdWx0aXBsZVJvd3Moe2NvbHVtbnMsIHJvd3N9KVxuICAgICAgOiByb3dzXG4gICAgY29uc3QgdGFibGVOYW1lID0gdGhpcy50YWJsZU5hbWUoKVxuXG4gICAgaWYgKCFyZXRyeUluZGl2aWR1YWxseU9uRmFpbHVyZSkge1xuICAgICAgYXdhaXQgdGhpcy5jb25uZWN0aW9uKCkuaW5zZXJ0TXVsdGlwbGUodGFibGVOYW1lLCBjb2x1bW5zLCBub3JtYWxpemVkUm93cylcbiAgICAgIGlmIChyZXR1cm5SZXN1bHRzKSByZXR1cm4ge3N1Y2NlZWRlZFJvd3M6IG5vcm1hbGl6ZWRSb3dzLnNsaWNlKCksIGZhaWxlZFJvd3M6IFtdLCBlcnJvcnM6IFtdfVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIC8vIFdyYXAgdGhlIGJhdGNoIGluIGEgdHJhbnNhY3Rpb24vc2F2ZXBvaW50LiBPbiBkYXRhYmFzZXMgdGhhdCBhYm9ydCB0aGVcbiAgICAgIC8vIHdob2xlIHRyYW5zYWN0aW9uIHdoZW4gYSBzdGF0ZW1lbnQgZmFpbHMgKFBvc3RncmVTUUwpLCBhIGZhaWxlZCBiYXRjaFxuICAgICAgLy8gd291bGQgb3RoZXJ3aXNlIHBvaXNvbiB0aGUgc3Vycm91bmRpbmcgdHJhbnNhY3Rpb24gc28gdGhhdCB0aGVcbiAgICAgIC8vIGluZGl2aWR1YWwgcmV0cmllcyBiZWxvdyBhbGwgZmFpbCB3aXRoIFwiY3VycmVudCB0cmFuc2FjdGlvbiBpcyBhYm9ydGVkXCIuXG4gICAgICAvLyB0cmFuc2FjdGlvbigpIG9wZW5zIGEgc2F2ZXBvaW50IHdoZW4gYWxyZWFkeSBpbnNpZGUgYSB0cmFuc2FjdGlvbiBhbmQgYVxuICAgICAgLy8gcmVhbCB0cmFuc2FjdGlvbiBvdGhlcndpc2UsIHNvIGEgZmFpbHVyZSByb2xscyBiYWNrIG9ubHkgdGhpcyBhdHRlbXB0LlxuICAgICAgYXdhaXQgdGhpcy5jb25uZWN0aW9uKCkudHJhbnNhY3Rpb24oYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCB0aGlzLmNvbm5lY3Rpb24oKS5pbnNlcnRNdWx0aXBsZSh0YWJsZU5hbWUsIGNvbHVtbnMsIG5vcm1hbGl6ZWRSb3dzKVxuICAgICAgfSlcbiAgICAgIGlmIChyZXR1cm5SZXN1bHRzKSByZXR1cm4ge3N1Y2NlZWRlZFJvd3M6IG5vcm1hbGl6ZWRSb3dzLnNsaWNlKCksIGZhaWxlZFJvd3M6IFtdLCBlcnJvcnM6IFtdfVxuICAgICAgcmV0dXJuXG4gICAgfSBjYXRjaCB7XG4gICAgICAvKipcbiAgICAgICAqIFJlc3VsdHMuXG4gICAgICAgKiBAdHlwZSB7e3N1Y2NlZWRlZFJvd3M6IEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PltdLCBmYWlsZWRSb3dzOiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj5bXSwgZXJyb3JzOiBBcnJheTx7cm93OiBBcnJheTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4sIGVycm9yOiBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0+fX0gKi9cbiAgICAgIGNvbnN0IHJlc3VsdHMgPSB7XG4gICAgICAgIHN1Y2NlZWRlZFJvd3M6IFtdLFxuICAgICAgICBmYWlsZWRSb3dzOiBbXSxcbiAgICAgICAgZXJyb3JzOiBbXVxuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IHJvdyBvZiBub3JtYWxpemVkUm93cykge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIC8vIEVhY2ggcmV0cnkgcnVucyBpbiBpdHMgb3duIHNhdmVwb2ludCBzbyBhIGZhaWxlZCByb3cgcm9sbHMgYmFjayBvbmx5XG4gICAgICAgICAgLy8gdGhhdCByb3cgYW5kIGxlYXZlcyB0aGUgc3Vycm91bmRpbmcgdHJhbnNhY3Rpb24gdXNhYmxlIGZvciB0aGUgcmVzdC5cbiAgICAgICAgICBhd2FpdCB0aGlzLmNvbm5lY3Rpb24oKS50cmFuc2FjdGlvbihhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmNvbm5lY3Rpb24oKS5pbnNlcnRNdWx0aXBsZSh0YWJsZU5hbWUsIGNvbHVtbnMsIFtyb3ddKVxuICAgICAgICAgIH0pXG4gICAgICAgICAgcmVzdWx0cy5zdWNjZWVkZWRSb3dzLnB1c2gocm93KVxuICAgICAgICB9IGNhdGNoIChyb3dFcnJvcikge1xuICAgICAgICAgIHJlc3VsdHMuZmFpbGVkUm93cy5wdXNoKHJvdylcbiAgICAgICAgICByZXN1bHRzLmVycm9ycy5wdXNoKHtyb3csIGVycm9yOiByb3dFcnJvcn0pXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKHJlc3VsdHMuZmFpbGVkUm93cy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGNvbnN0IGNvbWJpbmVkRXJyb3JzID0gcmVzdWx0cy5lcnJvcnMubWFwKChlbnRyeSwgaW5kZXgpID0+IHtcbiAgICAgICAgICBjb25zdCBtZXNzYWdlID0gZW50cnkuZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVudHJ5LmVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZW50cnkuZXJyb3IpXG4gICAgICAgICAgcmV0dXJuIGBbJHtpbmRleH1dICR7bWVzc2FnZX0uIFJvdzogJHt0aGlzLl9zYWZlU2VyaWFsaXplSW5zZXJ0Um93KGVudHJ5LnJvdyl9YFxuICAgICAgICB9KS5qb2luKFwiIHwgXCIpXG4gICAgICAgIGNvbnN0IGNvbWJpbmVkRXJyb3IgPSBuZXcgRXJyb3IoYGluc2VydE11bHRpcGxlIGZhaWxlZCBmb3IgJHtyZXN1bHRzLmZhaWxlZFJvd3MubGVuZ3RofSByb3dzLiAke2NvbWJpbmVkRXJyb3JzfWApXG5cbiAgICAgICAgaWYgKHJldHVyblJlc3VsdHMpIHJldHVybiByZXN1bHRzXG4gICAgICAgIHRocm93IGNvbWJpbmVkRXJyb3JcbiAgICAgIH1cblxuICAgICAgaWYgKHJldHVyblJlc3VsdHMpIHJldHVybiByZXN1bHRzXG4gICAgICByZXR1cm5cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgaW5zZXJ0IG11bHRpcGxlIHJvd3MuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7QXJyYXk8c3RyaW5nPn0gYXJncy5jb2x1bW5zIC0gQ29sdW1uIG5hbWVzLlxuICAgKiBAcGFyYW0ge0FycmF5PEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IGFyZ3Mucm93cyAtIFJvd3MgdG8gaW5zZXJ0LlxuICAgKiBAcmV0dXJucyB7QXJyYXk8QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBOb3JtYWxpemVkIHJvd3MuXG4gICAqL1xuICBzdGF0aWMgX25vcm1hbGl6ZUluc2VydE11bHRpcGxlUm93cyh7Y29sdW1ucywgcm93c30pIHtcbiAgICByZXR1cm4gcm93cy5tYXAoKHJvdykgPT4ge1xuICAgICAgaWYgKCFBcnJheS5pc0FycmF5KHJvdykgfHwgcm93Lmxlbmd0aCAhPT0gY29sdW1ucy5sZW5ndGgpIHtcbiAgICAgICAgY29uc3Qgcm93TGVuZ3RoID0gQXJyYXkuaXNBcnJheShyb3cpID8gcm93Lmxlbmd0aCA6IFwibm9uLWFycmF5XCJcblxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYGluc2VydE11bHRpcGxlIHJvdyBsZW5ndGggbWlzbWF0Y2guIEV4cGVjdGVkICR7Y29sdW1ucy5sZW5ndGh9IHZhbHVlcyBidXQgZ290ICR7cm93TGVuZ3RofS4gUm93OiAke0pTT04uc3RyaW5naWZ5KHJvdyl9YClcbiAgICAgIH1cblxuICAgICAgY29uc3Qgbm9ybWFsaXplZFJvdyA9IFtdXG5cbiAgICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPCBjb2x1bW5zLmxlbmd0aDsgaW5kZXgrKykge1xuICAgICAgICBjb25zdCBjb2x1bW5OYW1lID0gY29sdW1uc1tpbmRleF1cbiAgICAgICAgY29uc3QgdmFsdWUgPSByb3dbaW5kZXhdXG5cbiAgICAgICAgbm9ybWFsaXplZFJvd1tpbmRleF0gPSB0aGlzLl9ub3JtYWxpemVJbnNlcnRWYWx1ZUZvckNvbHVtbih7Y29sdW1uTmFtZSwgdmFsdWV9KVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gbm9ybWFsaXplZFJvd1xuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzYWZlIHNlcmlhbGl6ZSBpbnNlcnQgcm93LlxuICAgKiBAcGFyYW0ge0FycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcm93IC0gUm93IHRvIHNlcmlhbGl6ZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBTYWZlIHJvdyByZXByZXNlbnRhdGlvbi5cbiAgICovXG4gIHN0YXRpYyBfc2FmZVNlcmlhbGl6ZUluc2VydFJvdyhyb3cpIHtcbiAgICByZXR1cm4gZm9ybWF0VmFsdWUocm93KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIGluc2VydCB2YWx1ZSBmb3IgY29sdW1uLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jb2x1bW5OYW1lIC0gQ29sdW1uIG5hbWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MudmFsdWUgLSBDb2x1bW4gdmFsdWUuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBOb3JtYWxpemVkIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIF9ub3JtYWxpemVJbnNlcnRWYWx1ZUZvckNvbHVtbih7Y29sdW1uTmFtZSwgdmFsdWV9KSB7XG4gICAgY29uc3QgY29sdW1uID0gdGhpcy5nZXRDb2x1bW5zSGFzaCgpW2NvbHVtbk5hbWVdXG5cbiAgICBpZiAoIWNvbHVtbikgcmV0dXJuIHZhbHVlXG5cbiAgICBjb25zdCBjb2x1bW5UeXBlID0gY29sdW1uLmdldFR5cGUoKVxuICAgIGNvbnN0IG5vcm1hbGl6ZWRUeXBlID0gdHlwZW9mIGNvbHVtblR5cGUgPT09IFwic3RyaW5nXCIgPyBjb2x1bW5UeXBlLnRvTG93ZXJDYXNlKCkgOiB1bmRlZmluZWRcbiAgICBsZXQgbm9ybWFsaXplZFZhbHVlID0gdmFsdWVcblxuICAgIGlmIChub3JtYWxpemVkVHlwZSAmJiB0aGlzLl9pc0RhdGVMaWtlVHlwZShub3JtYWxpemVkVHlwZSkpIHtcbiAgICAgIG5vcm1hbGl6ZWRWYWx1ZSA9IHRoaXMuX25vcm1hbGl6ZURhdGVWYWx1ZUZvckluc2VydChub3JtYWxpemVkVmFsdWUpXG4gICAgfVxuXG4gICAgbm9ybWFsaXplZFZhbHVlID0gdGhpcy5fbm9ybWFsaXplU3FsaXRlQm9vbGVhblZhbHVlRm9ySW5zZXJ0KHtjb2x1bW5UeXBlLCB2YWx1ZTogbm9ybWFsaXplZFZhbHVlfSlcblxuICAgIGlmIChub3JtYWxpemVkVmFsdWUgPT09IFwiXCIgJiYgY29sdW1uLmdldE51bGwoKSAmJiAhdGhpcy5faXNTdHJpbmdUeXBlKG5vcm1hbGl6ZWRUeXBlKSkge1xuICAgICAgbm9ybWFsaXplZFZhbHVlID0gbnVsbFxuICAgIH1cblxuICAgIGlmIChub3JtYWxpemVkVHlwZSAmJiB0aGlzLl9pc051bWVyaWNUeXBlKG5vcm1hbGl6ZWRUeXBlKSkge1xuICAgICAgbm9ybWFsaXplZFZhbHVlID0gdGhpcy5fbm9ybWFsaXplTnVtZXJpY1ZhbHVlKHtjb2x1bW5UeXBlOiBub3JtYWxpemVkVHlwZSwgdmFsdWU6IG5vcm1hbGl6ZWRWYWx1ZX0pXG4gICAgfVxuXG4gICAgcmV0dXJuIG5vcm1hbGl6ZWRWYWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgc3RyaW5nIHR5cGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBjb2x1bW5UeXBlIC0gQ29sdW1uIHR5cGUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgc3RyaW5nLWxpa2UgdHlwZS5cbiAgICovXG4gIHN0YXRpYyBfaXNTdHJpbmdUeXBlKGNvbHVtblR5cGUpIHtcbiAgICBpZiAoIWNvbHVtblR5cGUpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3Qgc3RyaW5nVHlwZXMgPSBuZXcgU2V0KFtcImNoYXJcIiwgXCJ2YXJjaGFyXCIsIFwibnZhcmNoYXJcIiwgXCJzdHJpbmdcIiwgXCJlbnVtXCIsIFwianNvblwiLCBcImpzb25iXCIsIFwiY2l0ZXh0XCIsIFwiYmluYXJ5XCIsIFwidmFyYmluYXJ5XCJdKVxuXG4gICAgcmV0dXJuIGNvbHVtblR5cGUuaW5jbHVkZXMoXCJ1dWlkXCIpIHx8XG4gICAgICBjb2x1bW5UeXBlLmluY2x1ZGVzKFwidGV4dFwiKSB8fFxuICAgICAgc3RyaW5nVHlwZXMuaGFzKGNvbHVtblR5cGUpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyBudW1lcmljIHR5cGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb2x1bW5UeXBlIC0gQ29sdW1uIHR5cGUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgbnVtZXJpYy1saWtlIHR5cGUuXG4gICAqL1xuICBzdGF0aWMgX2lzTnVtZXJpY1R5cGUoY29sdW1uVHlwZSkge1xuICAgIHJldHVybiBjb2x1bW5UeXBlLmluY2x1ZGVzKFwiaW50XCIpIHx8XG4gICAgICBjb2x1bW5UeXBlLmluY2x1ZGVzKFwiZGVjaW1hbFwiKSB8fFxuICAgICAgY29sdW1uVHlwZS5pbmNsdWRlcyhcIm51bWVyaWNcIikgfHxcbiAgICAgIGNvbHVtblR5cGUuaW5jbHVkZXMoXCJmbG9hdFwiKSB8fFxuICAgICAgY29sdW1uVHlwZS5pbmNsdWRlcyhcImRvdWJsZVwiKSB8fFxuICAgICAgY29sdW1uVHlwZS5pbmNsdWRlcyhcInJlYWxcIilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBudW1lcmljIHZhbHVlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jb2x1bW5UeXBlIC0gQ29sdW1uIHR5cGUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MudmFsdWUgLSBWYWx1ZSB0byBub3JtYWxpemUuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBOb3JtYWxpemVkIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIF9ub3JtYWxpemVOdW1lcmljVmFsdWUoe2NvbHVtblR5cGUsIHZhbHVlfSkge1xuICAgIGlmICh2YWx1ZSA9PT0gXCJcIiB8fCB2YWx1ZSA9PT0gbnVsbCB8fCB2YWx1ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdmFsdWVcbiAgICBpZiAodHlwZW9mIHZhbHVlICE9PSBcInN0cmluZ1wiKSByZXR1cm4gdmFsdWVcblxuICAgIGlmIChjb2x1bW5UeXBlLmluY2x1ZGVzKFwiZGVjaW1hbFwiKSB8fCBjb2x1bW5UeXBlLmluY2x1ZGVzKFwibnVtZXJpY1wiKSkge1xuICAgICAgcmV0dXJuIHZhbHVlXG4gICAgfVxuXG4gICAgY29uc3QgcGFyc2VkID0gTnVtYmVyKHZhbHVlKVxuXG4gICAgaWYgKCFOdW1iZXIuaXNGaW5pdGUocGFyc2VkKSkgcmV0dXJuIHZhbHVlXG5cbiAgICBpZiAoY29sdW1uVHlwZS5pbmNsdWRlcyhcImludFwiKSkge1xuICAgICAgaWYgKCFOdW1iZXIuaXNTYWZlSW50ZWdlcihwYXJzZWQpKSByZXR1cm4gdmFsdWVcbiAgICAgIGlmICghL14tP1xcZCskLy50ZXN0KHZhbHVlKSkgcmV0dXJuIHZhbHVlXG4gICAgfVxuXG4gICAgcmV0dXJuIHBhcnNlZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIGRhdGUgdmFsdWUgZm9yIGluc2VydC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBWYWx1ZSB0byBub3JtYWxpemUuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBOb3JtYWxpemVkIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIF9ub3JtYWxpemVEYXRlVmFsdWVGb3JJbnNlcnQodmFsdWUpIHtcbiAgICByZXR1cm4gbm9ybWFsaXplRGF0ZVZhbHVlRm9yV3JpdGUodmFsdWUsIHt0aW1lWm9uZTogdGhpcy5fdGltZVpvbmVGb3JEYXRlV3JpdGUoKX0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgZGF0ZSBzdHJpbmcgZm9yIGluc2VydC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHZhbHVlIC0gRGF0ZSBzdHJpbmcgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCBEYXRlfSAtIFBhcnNlZCBkYXRlIG9yIG9yaWdpbmFsIHN0cmluZy5cbiAgICovXG4gIHN0YXRpYyBfbm9ybWFsaXplRGF0ZVN0cmluZ0Zvckluc2VydCh2YWx1ZSkge1xuICAgIHJldHVybiBub3JtYWxpemVEYXRlU3RyaW5nRm9yV3JpdGUodmFsdWUsIHt0aW1lWm9uZTogdGhpcy5fdGltZVpvbmVGb3JEYXRlV3JpdGUoKX0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0aW1lIHpvbmUgZm9yIGRhdGUgd3JpdGVzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIEFjdGl2ZSB0aW1lem9uZSBpZGVudGlmaWVyLlxuICAgKi9cbiAgc3RhdGljIF90aW1lWm9uZUZvckRhdGVXcml0ZSgpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5fZ2V0Q29uZmlndXJhdGlvbigpXG5cbiAgICByZXR1cm4gY29uZmlndXJhdGlvbi5nZXRFbnZpcm9ubWVudEhhbmRsZXIoKS5nZXRUaW1lWm9uZShjb25maWd1cmF0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIHNxbGl0ZSBib29sZWFuIHZhbHVlIGZvciBpbnNlcnQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgdW5kZWZpbmVkfSBhcmdzLmNvbHVtblR5cGUgLSBDb2x1bW4gdHlwZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy52YWx1ZSAtIFZhbHVlIHRvIG5vcm1hbGl6ZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIE5vcm1hbGl6ZWQgdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgX25vcm1hbGl6ZVNxbGl0ZUJvb2xlYW5WYWx1ZUZvckluc2VydCh7Y29sdW1uVHlwZSwgdmFsdWV9KSB7XG4gICAgaWYgKHRoaXMuZ2V0RGF0YWJhc2VUeXBlKCkgIT0gXCJzcWxpdGVcIikgcmV0dXJuIHZhbHVlXG4gICAgaWYgKCFjb2x1bW5UeXBlKSByZXR1cm4gdmFsdWVcbiAgICBpZiAoY29sdW1uVHlwZS50b0xvd2VyQ2FzZSgpICE9PSBcImJvb2xlYW5cIikgcmV0dXJuIHZhbHVlXG4gICAgaWYgKHZhbHVlID09PSB0cnVlKSByZXR1cm4gMVxuICAgIGlmICh2YWx1ZSA9PT0gZmFsc2UpIHJldHVybiAwXG5cbiAgICByZXR1cm4gdmFsdWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5leHQgcHJpbWFyeSBrZXkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgbmV4dCBwcmltYXJ5IGtleS5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBuZXh0UHJpbWFyeUtleSgpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIGNvbnN0IHByaW1hcnlLZXkgPSB0aGlzLnByaW1hcnlLZXkoKVxuICAgIGNvbnN0IHRhYmxlTmFtZSA9IHRoaXMudGFibGVOYW1lKClcbiAgICBjb25zdCBjb25uZWN0aW9uID0gdGhpcy5jb25uZWN0aW9uKClcbiAgICBjb25zdCBuZXdlc3RSZWNvcmQgPSBhd2FpdCB0aGlzLm9yZGVyKGAke2Nvbm5lY3Rpb24ucXVvdGVUYWJsZSh0YWJsZU5hbWUpfS4ke2Nvbm5lY3Rpb24ucXVvdGVDb2x1bW4ocHJpbWFyeUtleSl9YCkubGFzdCgpXG5cbiAgICBpZiAobmV3ZXN0UmVjb3JkKSB7XG4gICAgICBjb25zdCBpZCA9IG5ld2VzdFJlY29yZC5pZCgpXG5cbiAgICAgIGlmICh0eXBlb2YgaWQgPT0gXCJudW1iZXJcIikge1xuICAgICAgICByZXR1cm4gaWQgKyAxXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJJRCBmcm9tIG5ld2VzdCByZWNvcmQgd2Fzbid0IGEgbnVtYmVyXCIpXG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiAxXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHByaW1hcnkga2V5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcHJpbWFyeUtleSAtIFByaW1hcnkga2V5LlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBzdGF0aWMgc2V0UHJpbWFyeUtleShwcmltYXJ5S2V5KSB7XG4gICAgdGhpcy5fcHJpbWFyeUtleSA9IHByaW1hcnlLZXlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoaXMgY2xhc3MncyBvd24gYXR0cmlidXRlLWNhc3QgbWFwLCBjcmVhdGluZyBpdCBvbiB0aGUgY2xhc3MgaXRzZWxmXG4gICAqIChuZXZlciBpbmhlcml0ZWQgZnJvbSBhIHBhcmVudCkgc28gc3ViY2xhc3NlcyBkb24ndCBzaGFyZSB0aGUgc2FtZSBvYmplY3QuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSAtIERlY2xhcmVkIGNhc3RzIGtleWVkIGJ5IGF0dHJpYnV0ZSBuYW1lLlxuICAgKi9cbiAgc3RhdGljIGdldEF0dHJpYnV0ZUNhc3RzTWFwKCkge1xuICAgIGlmICghT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKHRoaXMsIFwiX2F0dHJpYnV0ZUNhc3RzXCIpIHx8ICF0aGlzLl9hdHRyaWJ1dGVDYXN0cykge1xuICAgICAgLyoqXG4gICAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgc3RyaW5nPn0gKi9cbiAgICAgIHRoaXMuX2F0dHJpYnV0ZUNhc3RzID0ge31cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fYXR0cmlidXRlQ2FzdHNcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWNsYXJlcyBhIFJhaWxzLXN0eWxlIHBlci1hdHRyaWJ1dGUgY2FzdCBzbyBhIGNvbHVtbiB3aG9zZSBpbnRyb3NwZWN0ZWQgdHlwZVxuICAgKiBpc24ndCB3aGF0IHRoZSBhcHAgd2FudHMgKGUuZy4gYW4gTVNTUUwgYGJpdGAgbWFwcGVkIHRvIGBudW1iZXJgKSBjYW4gYmVcbiAgICogZXhwb3NlZCBhcyBhbm90aGVyIHR5cGUgd2l0aCByZWFsIHJ1bnRpbWUgY29udmVyc2lvbi4gQ3VycmVudGx5IGZ1bGx5XG4gICAqIGltcGxlbWVudHMgdGhlIGBcImJvb2xlYW5cImAgY2FzdCAoMC8xIDwtPiBmYWxzZS90cnVlKTsgb3RoZXIgdHlwZXMgb25seSByZWNvcmRcbiAgICogdGhlIGxhYmVsIHNvIHRoZSBlZmZlY3RpdmUgdHlwZSBhbmQgZ2VuZXJhdGVkIHR5cGluZ3MgcmVmbGVjdCB0aGVtLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSAtIEF0dHJpYnV0ZSBuYW1lIChjYW1lbENhc2UpLCBlLmcuIGBcInNpY2h0YmFyVlZLXCJgLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdHlwZSAtIERlY2xhcmVkIHR5cGUsIGUuZy4gYFwiYm9vbGVhblwiYC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIGF0dHJpYnV0ZShhdHRyaWJ1dGVOYW1lLCB0eXBlKSB7XG4gICAgdGhpcy5nZXRBdHRyaWJ1dGVDYXN0c01hcCgpW2F0dHJpYnV0ZU5hbWVdID0gdHlwZVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGRlY2xhcmVkIGNhc3QgdHlwZSBmb3IgYW4gYXR0cmlidXRlLCBpZiBhbnkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUgKGNhbWVsQ2FzZSkuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gRGVjbGFyZWQgY2FzdCB0eXBlLCBvciB1bmRlZmluZWQgd2hlbiBub25lIGlzIGRlY2xhcmVkLlxuICAgKi9cbiAgc3RhdGljIGdldEF0dHJpYnV0ZUNhc3QoYXR0cmlidXRlTmFtZSkge1xuICAgIHJldHVybiB0aGlzLmdldEF0dHJpYnV0ZUNhc3RzTWFwKClbYXR0cmlidXRlTmFtZV1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHByaW1hcnkga2V5LlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBwcmltYXJ5IGtleS5cbiAgICovXG4gIHN0YXRpYyBwcmltYXJ5S2V5KCkge1xuICAgIGlmICh0aGlzLl9wcmltYXJ5S2V5KSByZXR1cm4gdGhpcy5fcHJpbWFyeUtleVxuXG4gICAgcmV0dXJuIFwiaWRcIlxuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdGhlIG1vZGVsIGhhcyBhIHNpbmdsZSBwcmltYXJ5IGtleSBjb2x1bW4uIGBzZXRQcmltYXJ5S2V5KG51bGwpYCAoZS5nLiBjb21wb3NpdGUta2V5XG4gICAqIGxlZ2FjeSB0YWJsZXMpIGRlY2xhcmVzIG5vIHNpbmdsZSBwcmltYXJ5IGtleTsgYHByaW1hcnlLZXkoKWAgc3RpbGwgZmFsbHMgYmFjayB0byBcImlkXCIgZm9yIHRoZVxuICAgKiBkZWZhdWx0IGNhc2UsIHNvIGNhbGxlcnMgdGhhdCBtdXN0IGRpc3Rpbmd1aXNoIFwibm8gcHJpbWFyeSBrZXlcIiB1c2UgdGhpcyBpbnN0ZWFkLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBGYWxzZSBvbmx5IHdoZW4gdGhlIHByaW1hcnkga2V5IHdhcyBleHBsaWNpdGx5IHNldCB0byBudWxsLlxuICAgKi9cbiAgc3RhdGljIGhhc1ByaW1hcnlLZXkoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3ByaW1hcnlLZXkgIT09IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNhdmUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBzYXZlKCkge1xuICAgIGNvbnN0IGlzTmV3UmVjb3JkID0gdGhpcy5pc05ld1JlY29yZCgpXG4gICAgbGV0IHJlc3VsdFxuXG4gICAgY29uc3Qgc2F2ZSA9IGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuX3J1bkxpZmVjeWNsZUNhbGxiYWNrcyhcImJlZm9yZVZhbGlkYXRpb25cIilcbiAgICAgIGF3YWl0IHRoaXMuX3J1blZhbGlkYXRpb25zKClcblxuICAgICAgY29uc3Qgc2F2ZUluVHJhbnNhY3Rpb24gPSBhc3luYyAoKSA9PiB7XG4gICAgICAgIGF3YWl0IHRoaXMuX3J1bkxpZmVjeWNsZUNhbGxiYWNrcyhcImJlZm9yZVNhdmVcIilcblxuICAgICAgICAvLyBJZiBhbnkgYmVsb25ncy10by1yZWxhdGlvbnNoaXBzIHdhcyBzYXZlZCwgdGhlbiB1cGRhdGVkLWF0IHNob3VsZCBzdGlsbCBiZSBzZXQgb24gdGhpcyByZWNvcmQuXG4gICAgICAgIGNvbnN0IHtzYXZlZENvdW50fSA9IGF3YWl0IHRoaXMuX2F1dG9TYXZlQmVsb25nc1RvUmVsYXRpb25zaGlwcygpXG5cbiAgICAgICAgaWYgKHRoaXMuaXNQZXJzaXN0ZWQoKSkge1xuICAgICAgICAgIGF3YWl0IHRoaXMuX3J1bkxpZmVjeWNsZUNhbGxiYWNrcyhcImJlZm9yZVVwZGF0ZVwiKVxuXG4gICAgICAgICAgLy8gSWYgYW55IGhhcy1tYW55LXJlbGF0aW9uc2hpcHMgd2lsbCBiZSBzYXZlZCwgdGhlbiB1cGRhdGVkLWF0IHNob3VsZCBzdGlsbCBiZSBzZXQgb24gdGhpcyByZWNvcmQuXG4gICAgICAgICAgY29uc3QgYXV0b1NhdmVIYXNNYW55cmVsYXRpb25zaGlwcyA9IHRoaXMuX2F1dG9TYXZlSGFzTWFueUFuZEhhc09uZVJlbGF0aW9uc2hpcHNUb1NhdmUoKVxuXG4gICAgICAgICAgaWYgKHRoaXMuX2hhc0NoYW5nZXMoKSB8fCBzYXZlZENvdW50ID4gMCB8fCBhdXRvU2F2ZUhhc01hbnlyZWxhdGlvbnNoaXBzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMuX3VwZGF0ZVJlY29yZFdpdGhDaGFuZ2VzKClcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBhd2FpdCB0aGlzLl9ydW5MaWZlY3ljbGVDYWxsYmFja3MoXCJhZnRlclVwZGF0ZVwiKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGF3YWl0IHRoaXMuX3J1bkxpZmVjeWNsZUNhbGxiYWNrcyhcImJlZm9yZUNyZWF0ZVwiKVxuICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMuX2NyZWF0ZU5ld1JlY29yZCgpXG4gICAgICAgICAgYXdhaXQgdGhpcy5fcnVuTGlmZWN5Y2xlQ2FsbGJhY2tzKFwiYWZ0ZXJDcmVhdGVcIilcbiAgICAgICAgfVxuXG4gICAgICAgIGF3YWl0IHRoaXMuX2F1dG9TYXZlSGFzTWFueUFuZEhhc09uZVJlbGF0aW9uc2hpcHMoe2lzTmV3UmVjb3JkfSlcbiAgICAgICAgYXdhaXQgdGhpcy5fYXV0b1NhdmVBdHRhY2htZW50cygpXG4gICAgICAgIGF3YWl0IHRoaXMuX3J1bkxpZmVjeWNsZUNhbGxiYWNrcyhcImFmdGVyU2F2ZVwiKVxuICAgICAgICBhd2FpdCB0aGlzLl9lbWl0UmVjb3JkQ2hhbmdlQWZ0ZXJDb21taXQoaXNOZXdSZWNvcmQgPyBcImNyZWF0ZVwiIDogXCJ1cGRhdGVcIilcbiAgICAgIH1cblxuICAgICAgaWYgKHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uLnRyYW5zYWN0aW9uKHNhdmVJblRyYW5zYWN0aW9uKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYXdhaXQgdGhpcy5nZXRNb2RlbENsYXNzKCkudHJhbnNhY3Rpb24oc2F2ZUluVHJhbnNhY3Rpb24pXG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uKSB7XG4gICAgICBhd2FpdCBzYXZlKClcbiAgICB9IGVsc2Uge1xuICAgICAgYXdhaXQgdGhpcy5fZ2V0Q29uZmlndXJhdGlvbigpLmVuc3VyZUNvbm5lY3Rpb25zKHtuYW1lOiBgJHt0aGlzLmdldE1vZGVsQ2xhc3MoKS5uYW1lfSBzYXZlYH0sIHNhdmUpXG4gICAgfVxuXG4gICAgdGhpcy5fYXNzaWduZWRBdHRyaWJ1dGVOYW1lcyA9IHVuZGVmaW5lZFxuXG4gICAgcmV0dXJuIHJlc3VsdFxuICB9XG5cbiAgYXN5bmMgX2F1dG9TYXZlQmVsb25nc1RvUmVsYXRpb25zaGlwcygpIHtcbiAgICBsZXQgc2F2ZWRDb3VudCA9IDBcblxuICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBpbiB0aGlzLl9pbnN0YW5jZVJlbGF0aW9uc2hpcHMpIHtcbiAgICAgIGNvbnN0IGluc3RhbmNlUmVsYXRpb25zaGlwID0gdGhpcy5faW5zdGFuY2VSZWxhdGlvbnNoaXBzW3JlbGF0aW9uc2hpcE5hbWVdXG5cbiAgICAgIGlmIChpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRUeXBlKCkgIT0gXCJiZWxvbmdzVG9cIikge1xuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBpZiAoaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0QXV0b1NhdmUoKSA9PT0gZmFsc2UpIHtcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgbW9kZWwgPSBpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRMb2FkZWRPclVuZGVmaW5lZCgpXG5cbiAgICAgIGlmIChtb2RlbCkge1xuICAgICAgICBpZiAobW9kZWwgaW5zdGFuY2VvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZCkge1xuICAgICAgICAgIGlmIChtb2RlbC5pc0NoYW5nZWQoKSkge1xuICAgICAgICAgICAgdGhpcy5iaW5kUmVsYXRlZFJlY29yZChtb2RlbClcbiAgICAgICAgICAgIGF3YWl0IG1vZGVsLnNhdmUoKVxuXG4gICAgICAgICAgICBjb25zdCBmb3JlaWduS2V5ID0gdGhpcy5fcmVsYXRpb25zaGlwRm9yZWlnbktleUF0dHJpYnV0ZShpbnN0YW5jZVJlbGF0aW9uc2hpcClcbiAgICAgICAgICAgIGNvbnN0IGZvcmVpZ25LZXlWYWx1ZSA9IHRoaXMuX2JlbG9uZ3NUb0ZvcmVpZ25LZXlWYWx1ZSh7bW9kZWwsIHJlbGF0aW9uc2hpcDogaW5zdGFuY2VSZWxhdGlvbnNoaXB9KVxuXG4gICAgICAgICAgICB0aGlzLnNldEF0dHJpYnV0ZShmb3JlaWduS2V5LCBmb3JlaWduS2V5VmFsdWUpXG5cbiAgICAgICAgICAgIGluc3RhbmNlUmVsYXRpb25zaGlwLnNldFByZWxvYWRlZCh0cnVlKVxuICAgICAgICAgICAgaW5zdGFuY2VSZWxhdGlvbnNoaXAuc2V0RGlydHkoZmFsc2UpXG5cbiAgICAgICAgICAgIHNhdmVkQ291bnQrK1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEV4cGVjdGVkIGEgcmVjb3JkIGJ1dCBnb3Q6ICR7dHlwZW9mIG1vZGVsfWApXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4ge3NhdmVkQ291bnR9XG4gIH1cblxuICBfYXV0b1NhdmVIYXNNYW55QW5kSGFzT25lUmVsYXRpb25zaGlwc1RvU2F2ZSgpIHtcbiAgICBjb25zdCByZWxhdGlvbnNoaXBzID0gW11cblxuICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBpbiB0aGlzLl9pbnN0YW5jZVJlbGF0aW9uc2hpcHMpIHtcbiAgICAgIGNvbnN0IGluc3RhbmNlUmVsYXRpb25zaGlwID0gdGhpcy5faW5zdGFuY2VSZWxhdGlvbnNoaXBzW3JlbGF0aW9uc2hpcE5hbWVdXG5cbiAgICAgIGlmIChpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRUeXBlKCkgIT0gXCJoYXNNYW55XCIgJiYgaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0VHlwZSgpICE9IFwiaGFzT25lXCIpIHtcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKGluc3RhbmNlUmVsYXRpb25zaGlwLmdldEF1dG9TYXZlKCkgPT09IGZhbHNlKSB7XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIC8qKlxuICAgICAgICogRGVmaW5lcyBsb2FkZWQuXG4gICAgICAgKiBAdHlwZSB7VmVsb2Npb3VzRGF0YWJhc2VSZWNvcmRbXX0gKi9cbiAgICAgIGxldCBsb2FkZWRcblxuICAgICAgY29uc3QgaGFzTWFueU9yT25lTG9hZGVkID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0TG9hZGVkT3JVbmRlZmluZWQoKVxuXG4gICAgICBpZiAoaGFzTWFueU9yT25lTG9hZGVkKSB7XG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGhhc01hbnlPck9uZUxvYWRlZCkpIHtcbiAgICAgICAgICBsb2FkZWQgPSBoYXNNYW55T3JPbmVMb2FkZWRcbiAgICAgICAgfSBlbHNlIGlmIChoYXNNYW55T3JPbmVMb2FkZWQgaW5zdGFuY2VvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZCkge1xuICAgICAgICAgIGxvYWRlZCA9IFtoYXNNYW55T3JPbmVMb2FkZWRdXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBoYXNPbmVMb2FkZWQgdG8gYmUgYSByZWNvcmQgYnV0IGl0IHdhc24ndDogJHt0eXBlb2YgaGFzTWFueU9yT25lTG9hZGVkfWApXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIGxldCB1c2VSZWxhdGlvbnNoaXAgPSBmYWxzZVxuXG4gICAgICBpZiAobG9hZGVkKSB7XG4gICAgICAgIGZvciAoY29uc3QgbW9kZWwgb2YgbG9hZGVkKSB7XG4gICAgICAgICAgdGhpcy5iaW5kUmVsYXRlZFJlY29yZChtb2RlbClcbiAgICAgICAgICBjb25zdCBmb3JlaWduS2V5ID0gbW9kZWwuX3JlbGF0aW9uc2hpcEZvcmVpZ25LZXlBdHRyaWJ1dGUoaW5zdGFuY2VSZWxhdGlvbnNoaXApXG5cbiAgICAgICAgICBtb2RlbC5zZXRBdHRyaWJ1dGUoZm9yZWlnbktleSwgdGhpcy5pZCgpKVxuXG4gICAgICAgICAgaWYgKG1vZGVsLmlzQ2hhbmdlZCgpKSB7XG4gICAgICAgICAgICB1c2VSZWxhdGlvbnNoaXAgPSB0cnVlXG4gICAgICAgICAgICBjb250aW51ZVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAodXNlUmVsYXRpb25zaGlwKSByZWxhdGlvbnNoaXBzLnB1c2goaW5zdGFuY2VSZWxhdGlvbnNoaXApXG4gICAgfVxuXG4gICAgcmV0dXJuIHJlbGF0aW9uc2hpcHNcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhIHJlbGF0aW9uc2hpcCBmb3JlaWduLWtleSBjb2x1bW4gdG8gdGhpcyBtb2RlbCdzIHB1YmxpYyBhdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2luc3RhbmNlLXJlbGF0aW9uc2hpcHMvYmFzZS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZCwgdHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkPn0gaW5zdGFuY2VSZWxhdGlvbnNoaXAgLSBSZWxhdGlvbnNoaXAgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IEF0dHJpYnV0ZSBuYW1lIGFjY2VwdGVkIGJ5IHNldEF0dHJpYnV0ZS9hc3NpZ24uXG4gICAqL1xuICBfcmVsYXRpb25zaGlwRm9yZWlnbktleUF0dHJpYnV0ZShpbnN0YW5jZVJlbGF0aW9uc2hpcCkge1xuICAgIGNvbnN0IGZvcmVpZ25LZXkgPSBpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRGb3JlaWduS2V5KClcblxuICAgIHJldHVybiB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKClbZm9yZWlnbktleV0gfHwgZm9yZWlnbktleVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYXV0byBzYXZlIGhhcyBtYW55IGFuZCBoYXMgb25lIHJlbGF0aW9uc2hpcHMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gYXJncy5pc05ld1JlY29yZCAtIFdoZXRoZXIgaXMgbmV3IHJlY29yZC5cbiAgICovXG4gIGFzeW5jIF9hdXRvU2F2ZUhhc01hbnlBbmRIYXNPbmVSZWxhdGlvbnNoaXBzKHtpc05ld1JlY29yZH0pIHtcbiAgICBmb3IgKGNvbnN0IGluc3RhbmNlUmVsYXRpb25zaGlwIG9mIHRoaXMuX2F1dG9TYXZlSGFzTWFueUFuZEhhc09uZVJlbGF0aW9uc2hpcHNUb1NhdmUoKSkge1xuICAgICAgbGV0IGhhc01hbnlPck9uZUxvYWRlZCA9IGluc3RhbmNlUmVsYXRpb25zaGlwLmdldExvYWRlZE9yVW5kZWZpbmVkKClcblxuICAgICAgLyoqXG4gICAgICAgKiBEZWZpbmVzIGxvYWRlZC5cbiAgICAgICAqIEB0eXBlIHtWZWxvY2lvdXNEYXRhYmFzZVJlY29yZFtdfSAqL1xuICAgICAgbGV0IGxvYWRlZFxuXG4gICAgICBpZiAoaGFzTWFueU9yT25lTG9hZGVkID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgbG9hZGVkID0gW11cbiAgICAgIH0gZWxzZSBpZiAoaGFzTWFueU9yT25lTG9hZGVkIGluc3RhbmNlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQpIHtcbiAgICAgICAgbG9hZGVkID0gW2hhc01hbnlPck9uZUxvYWRlZF1cbiAgICAgIH0gZWxzZSBpZiAoQXJyYXkuaXNBcnJheShoYXNNYW55T3JPbmVMb2FkZWQpKSB7XG4gICAgICAgIGxvYWRlZCA9IGhhc01hbnlPck9uZUxvYWRlZFxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmV4cGVjdGVkIHR5cGUgZm9yIGhhc01hbnlPck9uZUxvYWRlZDogJHt0eXBlb2YgaGFzTWFueU9yT25lTG9hZGVkfWApXG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3QgbW9kZWwgb2YgbG9hZGVkKSB7XG4gICAgICAgIHRoaXMuYmluZFJlbGF0ZWRSZWNvcmQobW9kZWwpXG4gICAgICAgIGNvbnN0IGZvcmVpZ25LZXkgPSBtb2RlbC5fcmVsYXRpb25zaGlwRm9yZWlnbktleUF0dHJpYnV0ZShpbnN0YW5jZVJlbGF0aW9uc2hpcClcblxuICAgICAgICBtb2RlbC5zZXRBdHRyaWJ1dGUoZm9yZWlnbktleSwgdGhpcy5pZCgpKVxuXG4gICAgICAgIGlmIChtb2RlbC5pc0NoYW5nZWQoKSkge1xuICAgICAgICAgIGF3YWl0IG1vZGVsLnNhdmUoKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChpc05ld1JlY29yZCkge1xuICAgICAgICBpbnN0YW5jZVJlbGF0aW9uc2hpcC5zZXRQcmVsb2FkZWQodHJ1ZSlcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBhdXRvIHNhdmUgYXR0YWNobWVudHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gcGVuZGluZyBhdHRhY2htZW50cyBoYXZlIGJlZW4gc2F2ZWQuXG4gICAqL1xuICBhc3luYyBfYXV0b1NhdmVBdHRhY2htZW50cygpIHtcbiAgICBmb3IgKGNvbnN0IGF0dGFjaG1lbnROYW1lIGluIHRoaXMuX2F0dGFjaG1lbnRzKSB7XG4gICAgICBjb25zdCBhdHRhY2htZW50ID0gdGhpcy5fYXR0YWNobWVudHNbYXR0YWNobWVudE5hbWVdXG5cbiAgICAgIGlmICghYXR0YWNobWVudC5oYXNQZW5kaW5nQXR0YWNobWVudHMoKSkgY29udGludWVcblxuICAgICAgYXdhaXQgYXR0YWNobWVudC5mbHVzaFBlbmRpbmdBdHRhY2htZW50cygpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdGFibGUgbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgdGFibGUgbmFtZS5cbiAgICovXG4gIHN0YXRpYyB0YWJsZU5hbWUoKSB7XG4gICAgaWYgKCF0aGlzLl90YWJsZU5hbWUpIHRoaXMuX3RhYmxlTmFtZSA9IGluZmxlY3Rpb24udW5kZXJzY29yZShpbmZsZWN0aW9uLnBsdXJhbGl6ZSh0aGlzLmdldE1vZGVsTmFtZSgpKSlcblxuICAgIHJldHVybiB0aGlzLl90YWJsZU5hbWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNldCB0YWJsZSBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdGFibGVOYW1lIC0gVGFibGUgbmFtZS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc3RhdGljIHNldFRhYmxlTmFtZSh0YWJsZU5hbWUpIHtcbiAgICB0aGlzLl90YWJsZU5hbWUgPSB0YWJsZU5hbWVcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRyYW5zYWN0aW9uLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8dm9pZD59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgZnVuY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBSZXNvbHZlcyB3aXRoIHRoZSB0cmFuc2FjdGlvbi5cbiAgICovXG4gIHN0YXRpYyBhc3luYyB0cmFuc2FjdGlvbihjYWxsYmFjaykge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlSW5pdGlhbGl6ZWQoKVxuXG4gICAgY29uc3QgdXNlVHJhbnNhY3Rpb25zID0gdGhpcy5jb25uZWN0aW9uKCkuZ2V0QXJncygpLnJlY29yZD8udHJhbnNhY3Rpb25zXG5cbiAgICBpZiAodXNlVHJhbnNhY3Rpb25zICE9PSBmYWxzZSkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuY29ubmVjdGlvbigpLnRyYW5zYWN0aW9uKGNhbGxiYWNrKVxuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gYXdhaXQgY2FsbGJhY2soKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRoZSBjYWxsYmFjayB3aGlsZSBob2xkaW5nIGEgbmFtZWQgYWR2aXNvcnkgbG9jay4gQ2FsbHMgd2l0aG91dFxuICAgKiBCeSBkZWZhdWx0IGNhbGxzIHVzZSB0aGUgY2FsbGVyIGNvbm5lY3Rpb24uIENhbGxzIHdpdGggYGRlZGljYXRlZENvbm5lY3Rpb25gXG4gICAqIHVzZSBhIHNwYXduZWQgbG9jayBjb25uZWN0aW9uIHRoYXQgaXMgcmVsZWFzZWQgYWZ0ZXIgdGhlIGNhbGxiYWNrIGZpbmlzaGVzLFxuICAgKiB3aGlsZSB0aGUgY2FsbGJhY2sgaXRzZWxmIHN0aWxsIHJ1bnMgYWdhaW5zdCB0aGUgY2FsbGVyL21vZGVsIGNvbm5lY3Rpb24uXG4gICAqIENhbGxzIHdpdGggYSBwb3NpdGl2ZSBgaG9sZFRpbWVvdXRNc2AgdXNlIGEgZGVkaWNhdGVkIGxvY2sgY29ubmVjdGlvbiBzb1xuICAgKiB0aW1lb3V0IGNsZWFudXAgY2FuIHJlbGVhc2UgdGhlIGxvY2sgZXZlbiB3aGVuIGNhbGxiYWNrIGRhdGFiYXNlIHdvcmsgaXNcbiAgICogc3R1Y2suIEFkdmlzb3J5IGxvY2tzIGFyZSBjb29wZXJhdGl2ZSBhbmQgc2Vzc2lvbi1zY29wZWQ6IHRoZXkgc2VyaWFsaXplXG4gICAqIGNhbGxlcnMgdGhhdCBvcHQgaW50byB0aGUgc2FtZSBgbmFtZWAsIHdpdGhvdXQgdG91Y2hpbmcgcm93IG9yIHRhYmxlIGxvY2tzLFxuICAgKiBzbyB1bnJlbGF0ZWQgdHJhZmZpYyBpcyBmcmVlIHRvIHByb2NlZWQuXG4gICAqXG4gICAqIFRoZSBsb2NrIGlzIGFjcXVpcmVkIGJlZm9yZSB0aGUgY2FsbGJhY2sgcnVucyBhbmQgcmVsZWFzZWQgaW4gYVxuICAgKiBgZmluYWxseWAgYmxvY2sgYWZ0ZXJ3YXJkcywgc28gdGhlIGNhbGxiYWNrJ3MgcmV0dXJuIHZhbHVlIGlzXG4gICAqIHByb3BhZ2F0ZWQgYW5kIHRocm93biBlcnJvcnMgc3RpbGwgcmVsZWFzZSB0aGUgbG9jay5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBDYWxsYmFjayB0byBpbnZva2Ugd2hpbGUgdGhlIGxvY2sgaXMgaGVsZC5cbiAgICogQHBhcmFtIHt7dGltZW91dE1zPzogbnVtYmVyIHwgbnVsbCwgaG9sZFRpbWVvdXRNcz86IG51bWJlciB8IG51bGwsIGRlZGljYXRlZENvbm5lY3Rpb24/OiBib29sZWFufX0gW2FyZ3NdIC0gYHRpbWVvdXRNc2AgY2FwcyBob3cgbG9uZyB3ZSB3YWl0IHRvIGFjcXVpcmUgdGhlIGxvY2s7IGBob2xkVGltZW91dE1zYCBjYXBzIGhvdyBsb25nIHRoZSBjYWxsYmFjayBtYXkgaG9sZCBpdCBiZWZvcmUgdGhlIGxvY2sgaXMgcmVsZWFzZWQgYW5kIGBBZHZpc29yeUxvY2tIb2xkVGltZW91dEVycm9yYCBpcyB0aHJvd247IGBkZWRpY2F0ZWRDb25uZWN0aW9uYCBzcGF3bnMgYSBzZXBhcmF0ZSBsb2NrIHNlc3Npb24gd2l0aG91dCBlbmFibGluZyBhIGhvbGQgdGltZW91dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgY2FsbGJhY2sncyByZXR1cm4gdmFsdWUuXG4gICAqIEB0aHJvd3Mge0Fkdmlzb3J5TG9ja1RpbWVvdXRFcnJvcn0gLSBJZiBgdGltZW91dE1zYCBlbGFwc2VzIGJlZm9yZSB0aGUgbG9jayBpcyBncmFudGVkLlxuICAgKiBAdGhyb3dzIHtBZHZpc29yeUxvY2tIb2xkVGltZW91dEVycm9yfSAtIElmIGBob2xkVGltZW91dE1zYCBlbGFwc2VzIHdoaWxlIHRoZSBjYWxsYmFjayBob2xkcyB0aGUgbG9jay5cbiAgICovXG4gIHN0YXRpYyBhc3luYyB3aXRoQWR2aXNvcnlMb2NrKG5hbWUsIGNhbGxiYWNrLCBhcmdzID0ge30pIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIGNvbnN0IHJ1bm5lciA9IG5ldyBBZHZpc29yeUxvY2tSdW5uZXIoe1xuICAgICAgY29uZmlndXJhdGlvbjogdGhpcy5fZ2V0Q29uZmlndXJhdGlvbigpLFxuICAgICAgY29ubmVjdGlvblByb3ZpZGVyOiAoKSA9PiB0aGlzLmNvbm5lY3Rpb24oKSxcbiAgICAgIGRhdGFiYXNlSWRlbnRpZmllcjogdGhpcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKVxuICAgIH0pXG5cbiAgICByZXR1cm4gYXdhaXQgcnVubmVyLndpdGhBZHZpc29yeUxvY2sobmFtZSwgY2FsbGJhY2ssIGFyZ3MpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0aGUgY2FsbGJhY2sgb25seSBpZiB0aGUgbmFtZWQgYWR2aXNvcnkgbG9jayBjYW4gYmUgYWNxdWlyZWRcbiAgICogaW1tZWRpYXRlbHkuIElmIHRoZSBsb2NrIGlzIGFscmVhZHkgaGVsZCBieSBhbnkgc2Vzc2lvbiwgdGhyb3dzXG4gICAqIGBBZHZpc29yeUxvY2tCdXN5RXJyb3JgIHdpdGhvdXQgd2FpdGluZy5cbiAgICogVXNlIHRoaXMgd2hlbiBjb250ZW50aW9uIGlzIGEgc2lnbmFsIHRoYXQgc29tZWJvZHkgZWxzZSBpcyBhbHJlYWR5XG4gICAqIGRvaW5nIHRoZSB3b3JrIGFuZCB5b3Ugd2FudCB0byBiYWlsIG91dCByYXRoZXIgdGhhbiBxdWV1ZSB1cC5cbiAgICogQHRlbXBsYXRlIFRcbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBMb2NrIG5hbWUuXG4gICAqIEBwYXJhbSB7KCkgPT4gUHJvbWlzZTxUPn0gY2FsbGJhY2sgLSBDYWxsYmFjayB0byBpbnZva2Ugd2hpbGUgdGhlIGxvY2sgaXMgaGVsZC5cbiAgICogQHBhcmFtIHt7aG9sZFRpbWVvdXRNcz86IG51bWJlciB8IG51bGwsIGRlZGljYXRlZENvbm5lY3Rpb24/OiBib29sZWFufX0gW2FyZ3NdIC0gYGhvbGRUaW1lb3V0TXNgIGNhcHMgaG93IGxvbmcgdGhlIGNhbGxiYWNrIG1heSBob2xkIHRoZSBsb2NrIGJlZm9yZSBpdCBpcyByZWxlYXNlZCBhbmQgYEFkdmlzb3J5TG9ja0hvbGRUaW1lb3V0RXJyb3JgIGlzIHRocm93bjsgYGRlZGljYXRlZENvbm5lY3Rpb25gIHNwYXducyBhIHNlcGFyYXRlIGxvY2sgc2Vzc2lvbiB3aXRob3V0IGVuYWJsaW5nIGEgaG9sZCB0aW1lb3V0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBjYWxsYmFjaydzIHJldHVybiB2YWx1ZS5cbiAgICogQHRocm93cyB7QWR2aXNvcnlMb2NrQnVzeUVycm9yfSAtIElmIHRoZSBsb2NrIGlzIGFscmVhZHkgaGVsZC5cbiAgICogQHRocm93cyB7QWR2aXNvcnlMb2NrSG9sZFRpbWVvdXRFcnJvcn0gLSBJZiBgaG9sZFRpbWVvdXRNc2AgZWxhcHNlcyB3aGlsZSB0aGUgY2FsbGJhY2sgaG9sZHMgdGhlIGxvY2suXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgd2l0aEFkdmlzb3J5TG9ja09yRmFpbChuYW1lLCBjYWxsYmFjaywgYXJncyA9IHt9KSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpXG5cbiAgICBjb25zdCBydW5uZXIgPSBuZXcgQWR2aXNvcnlMb2NrUnVubmVyKHtcbiAgICAgIGNvbmZpZ3VyYXRpb246IHRoaXMuX2dldENvbmZpZ3VyYXRpb24oKSxcbiAgICAgIGNvbm5lY3Rpb25Qcm92aWRlcjogKCkgPT4gdGhpcy5jb25uZWN0aW9uKCksXG4gICAgICBkYXRhYmFzZUlkZW50aWZpZXI6IHRoaXMuZ2V0RGF0YWJhc2VJZGVudGlmaWVyKClcbiAgICB9KVxuXG4gICAgcmV0dXJuIGF3YWl0IHJ1bm5lci53aXRoQWR2aXNvcnlMb2NrT3JGYWlsKG5hbWUsIGNhbGxiYWNrLCBhcmdzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYGNhbGxiYWNrYCwgcmVqZWN0aW5nIHdpdGggYEFkdmlzb3J5TG9ja0hvbGRUaW1lb3V0RXJyb3JgIGlmIGl0IGhhc1xuICAgKiBub3Qgc2V0dGxlZCB3aXRoaW4gYGhvbGRUaW1lb3V0TXNgLiBUaGUgY2FsbGJhY2sgaXMgbm90IGNhbmNlbGxlZCDigJQgdGhpcyBpc1xuICAgKiBhIHNhZmV0eSBuZXQsIG5vdCBjYW5jZWxsYXRpb24uXG4gICAqIEB0ZW1wbGF0ZSBUXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTG9jayBuYW1lIChmb3IgdGhlIGVycm9yIG1lc3NhZ2UpLlxuICAgKiBAcGFyYW0geygpID0+IFByb21pc2U8VD59IGNhbGxiYWNrIC0gQ2FsbGJhY2sgaG9sZGluZyB0aGUgbG9jay5cbiAgICogQHBhcmFtIHtudW1iZXIgfCBudWxsfSBbaG9sZFRpbWVvdXRNc10gLSBNYXggaG9sZCB0aW1lOyBmYWxzeSBkaXNhYmxlcyB0aGUgdGltZW91dC5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IC0gQ2FsbGJhY2sgcmVzdWx0IGFmdGVyIHRoZSBsb2NrLXByb3RlY3RlZCBvcGVyYXRpb24uXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgcnVuV2l0aEFkdmlzb3J5TG9ja0hvbGRUaW1lb3V0KG5hbWUsIGNhbGxiYWNrLCBob2xkVGltZW91dE1zKSB7XG4gICAgcmV0dXJuIGF3YWl0IEFkdmlzb3J5TG9ja1J1bm5lci5ydW5XaXRoQWR2aXNvcnlMb2NrSG9sZFRpbWVvdXQobmFtZSwgY2FsbGJhY2ssIGhvbGRUaW1lb3V0TXMpXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0cnVlIGlmIHRoZSBuYW1lZCBhZHZpc29yeSBsb2NrIGlzIGN1cnJlbnRseSBoZWxkIGJ5IGFueVxuICAgKiBzZXNzaW9uLiBQcmltYXJpbHkgdXNlZnVsIGFzIGEgZGlhZ25vc3RpYzsgY2FsbGVycyB0aGF0IHdhbnQgdG8gYWN0XG4gICAqIG9uIHRoZSByZXN1bHQgc2hvdWxkIHByZWZlciBgd2l0aEFkdmlzb3J5TG9ja09yRmFpbGAgdG8gYXZvaWQgYVxuICAgKiBUT0NUT1Ugd2luZG93IGJldHdlZW4gdGhlIGNoZWNrIGFuZCB0aGUgYWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIExvY2sgbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gV2hldGhlciB0aGUgYWR2aXNvcnkgbG9jayBpcyBjdXJyZW50bHkgaGVsZC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBoYXNBZHZpc29yeUxvY2sobmFtZSkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlSW5pdGlhbGl6ZWQoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuY29ubmVjdGlvbigpLmlzQWR2aXNvcnlMb2NrSGVsZChuYW1lKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdHJhbnNsYXRlcy5cbiAgICogQHBhcmFtIHsuLi5zdHJpbmd9IG5hbWVzIC0gTmFtZXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHN0YXRpYyB0cmFuc2xhdGVzKC4uLm5hbWVzKSB7XG4gICAgY29uc3QgdHJhbnNsYXRpb25zID0gdGhpcy5nZXRUcmFuc2xhdGlvbnNNYXAoKVxuXG4gICAgZm9yIChjb25zdCBuYW1lIG9mIG5hbWVzKSB7XG4gICAgICBpZiAobmFtZSBpbiB0cmFuc2xhdGlvbnMpIHRocm93IG5ldyBFcnJvcihgVHJhbnNsYXRpb24gYWxyZWFkeSBleGlzdHM6ICR7bmFtZX1gKVxuXG4gICAgICB0cmFuc2xhdGlvbnNbbmFtZV0gPSB7fVxuXG4gICAgICBpZiAoIXRoaXMuX3JlbGF0aW9uc2hpcEV4aXN0cyhcInRyYW5zbGF0aW9uc1wiKSkge1xuICAgICAgICB0aGlzLl9kZWZpbmVSZWxhdGlvbnNoaXAoXCJ0cmFuc2xhdGlvbnNcIiwge2RlcGVuZGVudDogXCJkZXN0cm95XCIsIGtsYXNzOiB0aGlzLmdldFRyYW5zbGF0aW9uQ2xhc3MoKSwgdHlwZTogXCJoYXNNYW55XCJ9KVxuICAgICAgfVxuXG4gICAgICBpZiAoIXRoaXMuX3JlbGF0aW9uc2hpcEV4aXN0cyhcImN1cnJlbnRUcmFuc2xhdGlvblwiKSkge1xuICAgICAgICB0aGlzLl9kZWZpbmVSZWxhdGlvbnNoaXAoXCJjdXJyZW50VHJhbnNsYXRpb25cIiwge1xuICAgICAgICAgIGtsYXNzOiB0aGlzLmdldFRyYW5zbGF0aW9uQ2xhc3MoKSxcbiAgICAgICAgICBzY29wZTogKHF1ZXJ5KSA9PiB0aGlzLmN1cnJlbnRUcmFuc2xhdGlvblNjb3BlKHF1ZXJ5KSxcbiAgICAgICAgICB0eXBlOiBcImhhc09uZVwiXG4gICAgICAgIH0pXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3VycmVudCB0cmFuc2xhdGlvbiBzY29wZS5cbiAgICogQHBhcmFtIHtNb2RlbENsYXNzUXVlcnl9IHF1ZXJ5IC0gVHJhbnNsYXRpb24gcXVlcnkuXG4gICAqIEByZXR1cm5zIHtNb2RlbENsYXNzUXVlcnl9IC0gU2NvcGVkIHF1ZXJ5LlxuICAgKi9cbiAgc3RhdGljIGN1cnJlbnRUcmFuc2xhdGlvblNjb3BlKHF1ZXJ5KSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuX2dldENvbmZpZ3VyYXRpb24oKVxuICAgIGNvbnN0IGxvY2FsZSA9IGNvbmZpZ3VyYXRpb24uZ2V0TG9jYWxlKClcbiAgICBjb25zdCBmYWxsYmFja3MgPSBjb25maWd1cmF0aW9uLmdldExvY2FsZUZhbGxiYWNrcygpXG4gICAgY29uc3QgbG9jYWxlcyA9IGxvY2FsZSA/IChmYWxsYmFja3M/Lltsb2NhbGVdIHx8IFtsb2NhbGVdKSA6IFtdXG5cbiAgICBpZiAobG9jYWxlcy5sZW5ndGggPT09IDApIHJldHVybiBxdWVyeS53aGVyZShcIjE9MFwiKVxuXG4gICAgY29uc3QgZHJpdmVyID0gcXVlcnkuZHJpdmVyXG4gICAgY29uc3QgdHJhbnNsYXRpb25DbGFzcyA9IHRoaXMuZ2V0VHJhbnNsYXRpb25DbGFzcygpXG4gICAgY29uc3QgcmVsYXRpb25zaGlwID0gdGhpcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUoXCJjdXJyZW50VHJhbnNsYXRpb25cIilcbiAgICBjb25zdCB0YWJsZU5hbWUgPSB0cmFuc2xhdGlvbkNsYXNzLnRhYmxlTmFtZSgpXG4gICAgY29uc3Qgc2NvcGVUYWJsZVJlZmVyZW5jZSA9IGAke3RhYmxlTmFtZX1fY3VycmVudF90cmFuc2xhdGlvbl9zY29wZWBcbiAgICBjb25zdCB0YXJnZXRUYWJsZVNxbCA9IGRyaXZlci5xdW90ZVRhYmxlKHF1ZXJ5LmdldFRhYmxlUmVmZXJlbmNlRm9ySm9pbigpKVxuICAgIGNvbnN0IHNjb3BlVGFibGVTcWwgPSBkcml2ZXIucXVvdGVUYWJsZShzY29wZVRhYmxlUmVmZXJlbmNlKVxuICAgIGNvbnN0IHNjb3BlVGFibGVGcm9tU3FsID0gYCR7ZHJpdmVyLnF1b3RlVGFibGUodGFibGVOYW1lKX0gQVMgJHtzY29wZVRhYmxlU3FsfWBcbiAgICBjb25zdCBwcmltYXJ5S2V5Q29sdW1uID0gdHJhbnNsYXRpb25DbGFzcy5wcmltYXJ5S2V5KClcbiAgICBjb25zdCBmb3JlaWduS2V5Q29sdW1uID0gcmVsYXRpb25zaGlwLmdldEZvcmVpZ25LZXkoKVxuICAgIGNvbnN0IHRhcmdldFByaW1hcnlLZXlTcWwgPSBgJHt0YXJnZXRUYWJsZVNxbH0uJHtkcml2ZXIucXVvdGVDb2x1bW4ocHJpbWFyeUtleUNvbHVtbil9YFxuICAgIGNvbnN0IHRhcmdldEZvcmVpZ25LZXlTcWwgPSBgJHt0YXJnZXRUYWJsZVNxbH0uJHtkcml2ZXIucXVvdGVDb2x1bW4oZm9yZWlnbktleUNvbHVtbil9YFxuICAgIGNvbnN0IHNjb3BlUHJpbWFyeUtleVNxbCA9IGAke3Njb3BlVGFibGVTcWx9LiR7ZHJpdmVyLnF1b3RlQ29sdW1uKHByaW1hcnlLZXlDb2x1bW4pfWBcbiAgICBjb25zdCBzY29wZUZvcmVpZ25LZXlTcWwgPSBgJHtzY29wZVRhYmxlU3FsfS4ke2RyaXZlci5xdW90ZUNvbHVtbihmb3JlaWduS2V5Q29sdW1uKX1gXG4gICAgY29uc3Qgc2NvcGVMb2NhbGVTcWwgPSBgJHtzY29wZVRhYmxlU3FsfS4ke2RyaXZlci5xdW90ZUNvbHVtbihcImxvY2FsZVwiKX1gXG4gICAgY29uc3QgbG9jYWxlTGlzdFNxbCA9IGxvY2FsZXMubWFwKChmYWxsYmFja0xvY2FsZSkgPT4gZHJpdmVyLnF1b3RlKGZhbGxiYWNrTG9jYWxlKSkuam9pbihcIiwgXCIpXG4gICAgY29uc3QgbG9jYWxlT3JkZXJTcWwgPSBsb2NhbGVzLm1hcCgoZmFsbGJhY2tMb2NhbGUsIGluZGV4KSA9PiBgV0hFTiAke3Njb3BlTG9jYWxlU3FsfSA9ICR7ZHJpdmVyLnF1b3RlKGZhbGxiYWNrTG9jYWxlKX0gVEhFTiAke2RyaXZlci5xdW90ZShpbmRleCl9YCkuam9pbihcIiBcIilcbiAgICBjb25zdCBmYWxsYmFja09yZGVyU3FsID0gYENBU0UgJHtsb2NhbGVPcmRlclNxbH0gRUxTRSAke2RyaXZlci5xdW90ZShsb2NhbGVzLmxlbmd0aCl9IEVORGBcbiAgICBjb25zdCBzZWxlY3RlZFRyYW5zbGF0aW9uU3FsID0gZHJpdmVyLmdldFR5cGUoKSA9PSBcIm1zc3FsXCJcbiAgICAgID8gYFNFTEVDVCBUT1AgMSAke3Njb3BlUHJpbWFyeUtleVNxbH0gRlJPTSAke3Njb3BlVGFibGVGcm9tU3FsfSBXSEVSRSAke3Njb3BlRm9yZWlnbktleVNxbH0gPSAke3RhcmdldEZvcmVpZ25LZXlTcWx9IEFORCAke3Njb3BlTG9jYWxlU3FsfSBJTiAoJHtsb2NhbGVMaXN0U3FsfSkgT1JERVIgQlkgJHtmYWxsYmFja09yZGVyU3FsfSwgJHtzY29wZVByaW1hcnlLZXlTcWx9IEFTQ2BcbiAgICAgIDogYFNFTEVDVCAke3Njb3BlUHJpbWFyeUtleVNxbH0gRlJPTSAke3Njb3BlVGFibGVGcm9tU3FsfSBXSEVSRSAke3Njb3BlRm9yZWlnbktleVNxbH0gPSAke3RhcmdldEZvcmVpZ25LZXlTcWx9IEFORCAke3Njb3BlTG9jYWxlU3FsfSBJTiAoJHtsb2NhbGVMaXN0U3FsfSkgT1JERVIgQlkgJHtmYWxsYmFja09yZGVyU3FsfSwgJHtzY29wZVByaW1hcnlLZXlTcWx9IEFTQyBMSU1JVCAxYFxuXG4gICAgcmV0dXJuIHF1ZXJ5LndoZXJlKGAke3RhcmdldFByaW1hcnlLZXlTcWx9ID0gKCR7c2VsZWN0ZWRUcmFuc2xhdGlvblNxbH0pYClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCB0cmFuc2xhdGlvbiBjbGFzcy5cbiAgICogQHJldHVybnMge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gLSBUaGUgdHJhbnNsYXRpb24gY2xhc3MuXG4gICAqL1xuICBzdGF0aWMgZ2V0VHJhbnNsYXRpb25DbGFzcygpIHtcbiAgICBpZiAodGhpcy5fdHJhbnNsYXRpb25DbGFzcykgcmV0dXJuIHRoaXMuX3RyYW5zbGF0aW9uQ2xhc3NcbiAgICBpZiAodGhpcy50YWJsZU5hbWUoKS5lbmRzV2l0aChcIl90cmFuc2xhdGlvbnNcIikpIHRocm93IG5ldyBFcnJvcihcIlRyeWluZyB0byBkZWZpbmUgYSB0cmFuc2xhdGlvbnMgY2xhc3MgZm9yIGEgdHJhbnNsYXRpb24gY2xhc3NcIilcblxuICAgIGNvbnN0IGNsYXNzTmFtZSA9IGAke3RoaXMuZ2V0TW9kZWxOYW1lKCl9VHJhbnNsYXRpb25gXG4gICAgY29uc3QgVHJhbnNsYXRpb25DbGFzcyA9IGNsYXNzIFRyYW5zbGF0aW9uIGV4dGVuZHMgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQge31cbiAgICBjb25zdCBiZWxvbmdzVG8gPSBzaW5ndWxhcml6ZU1vZGVsTmFtZShpbmZsZWN0aW9uLmNhbWVsaXplKHRoaXMudGFibGVOYW1lKCksIHRydWUpKVxuXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KFRyYW5zbGF0aW9uQ2xhc3MsIFwibmFtZVwiLCB7dmFsdWU6IGNsYXNzTmFtZX0pXG4gICAgVHJhbnNsYXRpb25DbGFzcy5zZXRUYWJsZU5hbWUodGhpcy5nZXRUcmFuc2xhdGlvbnNUYWJsZU5hbWUoKSlcbiAgICBUcmFuc2xhdGlvbkNsYXNzLmJlbG9uZ3NUbyhiZWxvbmdzVG8pXG5cbiAgICBpZiAodGhpcy5oYXNUZW5hbnREYXRhYmFzZUlkZW50aWZpZXJSZXNvbHZlcigpKSB7XG4gICAgICBjb25zdCB0cmFuc2xhdGVkTW9kZWxDbGFzcyA9IHRoaXNcblxuICAgICAgVHJhbnNsYXRpb25DbGFzcy5zd2l0Y2hlc1RlbmFudERhdGFiYXNlKCh7dGVuYW50fSkgPT4gdHJhbnNsYXRlZE1vZGVsQ2xhc3MuZ2V0VGVuYW50RGF0YWJhc2VJZGVudGlmaWVyKHRlbmFudCkpXG4gICAgfVxuXG4gICAgdGhpcy5fdHJhbnNsYXRpb25DbGFzcyA9IFRyYW5zbGF0aW9uQ2xhc3NcblxuICAgIHJldHVybiB0aGlzLl90cmFuc2xhdGlvbkNsYXNzXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdHJhbnNsYXRpb25zIHRhYmxlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHRyYW5zbGF0aW9ucyB0YWJsZSBuYW1lLlxuICAgKi9cbiAgc3RhdGljIGdldFRyYW5zbGF0aW9uc1RhYmxlTmFtZSgpIHtcbiAgICBjb25zdCB0YWJsZU5hbWVQYXJ0cyA9IHRoaXMudGFibGVOYW1lKCkuc3BsaXQoXCJfXCIpXG5cbiAgICB0YWJsZU5hbWVQYXJ0c1t0YWJsZU5hbWVQYXJ0cy5sZW5ndGggLSAxXSA9IGluZmxlY3Rpb24uc2luZ3VsYXJpemUodGFibGVOYW1lUGFydHNbdGFibGVOYW1lUGFydHMubGVuZ3RoIC0gMV0pXG5cbiAgICByZXR1cm4gYCR7dGFibGVOYW1lUGFydHMuam9pbihcIl9cIil9X3RyYW5zbGF0aW9uc2BcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGhhcyB0cmFuc2xhdGlvbnMgdGFibGUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSAtIFJlc29sdmVzIHdpdGggV2hldGhlciBpdCBoYXMgdHJhbnNsYXRpb25zIHRhYmxlLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGhhc1RyYW5zbGF0aW9uc1RhYmxlKCkge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLmNvbm5lY3Rpb24oKS5nZXRUYWJsZUJ5TmFtZSh0aGlzLmdldFRyYW5zbGF0aW9uc1RhYmxlTmFtZSgpKVxuXG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFkZHMgYSB2YWxpZGF0aW9uIHRvIGFuIGF0dHJpYnV0ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgVGhlIG5hbWUgb2YgdGhlIGF0dHJpYnV0ZSB0byB2YWxpZGF0ZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBib29sZWFuIHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gdmFsaWRhdG9ycyBUaGUgdmFsaWRhdG9ycyB0byBhZGQuIEtleSBpcyB0aGUgdmFsaWRhdG9yIG5hbWUsIHZhbHVlIGlzIHRoZSB2YWxpZGF0b3IgYXJndW1lbnRzLlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHZhbGlkYXRlcyhhdHRyaWJ1dGVOYW1lLCB2YWxpZGF0b3JzKSB7XG4gICAgZm9yIChjb25zdCB2YWxpZGF0b3JOYW1lIGluIHZhbGlkYXRvcnMpIHtcbiAgICAgIC8qKlxuICAgICAgICogRGVmaW5lcyB2YWxpZGF0b3JBcmdzLlxuICAgICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICAgIGxldCB2YWxpZGF0b3JBcmdzXG5cbiAgICAgIC8qKlxuICAgICAgICogVXNlIHZhbGlkYXRvci5cbiAgICAgICAqIEB0eXBlIHtib29sZWFufSAqL1xuICAgICAgbGV0IHVzZVZhbGlkYXRvciA9IHRydWVcblxuICAgICAgY29uc3QgdmFsaWRhdG9yQXJnc0NhbmRpZGF0ZSA9IHZhbGlkYXRvcnNbdmFsaWRhdG9yTmFtZV1cblxuICAgICAgaWYgKHR5cGVvZiB2YWxpZGF0b3JBcmdzQ2FuZGlkYXRlID09IFwiYm9vbGVhblwiKSB7XG4gICAgICAgIHZhbGlkYXRvckFyZ3MgPSB7fVxuICAgICAgICB1c2VWYWxpZGF0b3JcblxuICAgICAgICBpZiAoIXZhbGlkYXRvckFyZ3NDYW5kaWRhdGUpIHtcbiAgICAgICAgICB1c2VWYWxpZGF0b3IgPSBmYWxzZVxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB2YWxpZGF0b3JBcmdzID0gdmFsaWRhdG9yQXJnc0NhbmRpZGF0ZVxuICAgICAgfVxuXG4gICAgICBpZiAoIXVzZVZhbGlkYXRvcikge1xuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCBWYWxpZGF0b3JDbGFzcyA9IHRoaXMuZ2V0VmFsaWRhdG9yVHlwZSh2YWxpZGF0b3JOYW1lKVxuICAgICAgY29uc3QgdmFsaWRhdG9yID0gbmV3IFZhbGlkYXRvckNsYXNzKHthdHRyaWJ1dGVOYW1lLCBhcmdzOiB2YWxpZGF0b3JBcmdzfSlcblxuICAgICAgaWYgKCF0aGlzLl92YWxpZGF0b3JzKSB0aGlzLl92YWxpZGF0b3JzID0ge31cbiAgICAgIGlmICghKGF0dHJpYnV0ZU5hbWUgaW4gdGhpcy5fdmFsaWRhdG9ycykpIHRoaXMuX3ZhbGlkYXRvcnNbYXR0cmlidXRlTmFtZV0gPSBbXVxuXG4gICAgICB0aGlzLl92YWxpZGF0b3JzW2F0dHJpYnV0ZU5hbWVdLnB1c2godmFsaWRhdG9yKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgZ2FwLWxlc3MgcG9zaXRpb25hbCBsaXN0IGNhbGxiYWNrcyBmb3IgYSBjb2x1bW4gc2NvcGVkIGJ5XG4gICAqIGFub3RoZXIgY29sdW1uLiBJbnNlcnRzIGFuZCBtb3ZlcyBzaGlmdCBzdXJyb3VuZGluZyBwb3NpdGlvbnMgc28gdGhlXG4gICAqIGxpc3Qgc3RheXMgY29tcGFjdCAoMSwyLDMsLi4uKS4gRGVzdHJveXMgY2xvc2UgdGhlIHJlc3VsdGluZyBnYXAuXG4gICAqXG4gICAqIENhbGxlcnMgbXVzdCBlbnN1cmUgYSBVTklRVUUgaW5kZXggb24gKHNjb3BlQ29sdW1uLCBwb3NpdGlvbkNvbHVtbilcbiAgICogZXhpc3RzIGluIHRoZSBkYXRhYmFzZSDigJQgdXNlIGBNaWdyYXRpb24uYWRkQWN0c0FzTGlzdCgpYCBmb3IgdGhlXG4gICAqIHNjaGVtYSBoYWxmLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcG9zaXRpb25Db2x1bW4gLSBjYW1lbENhc2UgcG9zaXRpb24gYXR0cmlidXRlIChlLmcuIFwicm93TnVtYmVyXCIpLlxuICAgKiBAcGFyYW0ge29iamVjdH0gb3B0aW9ucyAtIE9wdGlvbnMgd2l0aCBhIHJlcXVpcmVkIHNjb3BlIGF0dHJpYnV0ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG9wdGlvbnMuc2NvcGUgLSBjYW1lbENhc2Ugc2NvcGUgYXR0cmlidXRlIChlLmcuIFwiYm9hcmRDb2x1bW5JZFwiKS5cbiAgICovXG4gIHN0YXRpYyBhY3RzQXNMaXN0KHBvc2l0aW9uQ29sdW1uLCBvcHRpb25zKSB7XG4gICAgY29uc3Qge3Njb3BlfSA9IG9wdGlvbnNcblxuICAgIHJlZ2lzdGVyQWN0c0FzTGlzdENhbGxiYWNrcyh0aGlzLCBwb3NpdGlvbkNvbHVtbiwge3Njb3BlfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRyYW5zbGF0aW9ucyBsb2FkZWQuXG4gICAqIEBhYnN0cmFjdFxuICAgKiBAcmV0dXJucyB7VHJhbnNsYXRpb25CYXNlW119IC0gVGhlIHRyYW5zbGF0aW9ucyBsb2FkZWQuXG4gICAqL1xuICB0cmFuc2xhdGlvbnNMb2FkZWQoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiJ3RyYW5zbGF0aW9uc0xvYWRlZCcgbm90IGltcGxlbWVudGVkXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdHJhbnNsYXRlZCBhdHRyaWJ1dGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBuYW1lIC0gTmFtZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGxvY2FsZSAtIExvY2FsZS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gLSBUaGUgdHJhbnNsYXRlZCBhdHRyaWJ1dGUsIGlmIGZvdW5kLlxuICAgKi9cbiAgX2dldFRyYW5zbGF0ZWRBdHRyaWJ1dGUobmFtZSwgbG9jYWxlKSB7XG4gICAgY29uc3QgdHJhbnNsYXRpb24gPSB0aGlzLnRyYW5zbGF0aW9uc0xvYWRlZCgpLmZpbmQoKHRyYW5zbGF0aW9uKSA9PiB0cmFuc2xhdGlvbi5sb2NhbGUoKSA9PSBsb2NhbGUpXG5cbiAgICBpZiAodHJhbnNsYXRpb24pIHtcbiAgICAgIC8qKlxuICAgICAgICogRGljdC5cbiAgICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgICBjb25zdCBkaWN0ID0gdHJhbnNsYXRpb25cblxuICAgICAgY29uc3QgYXR0cmlidXRlTWV0aG9kID0gLyoqIEB0eXBlIHsoKSA9PiBzdHJpbmcgfCB1bmRlZmluZWR9ICovIChkaWN0W25hbWVdKVxuXG4gICAgICBpZiAodHlwZW9mIGF0dHJpYnV0ZU1ldGhvZCA9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgcmV0dXJuIGF0dHJpYnV0ZU1ldGhvZC5iaW5kKHRyYW5zbGF0aW9uKSgpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIHN1Y2ggdHJhbnNsYXRlZCBtZXRob2Q6ICR7bmFtZX0gKCR7dHlwZW9mIGF0dHJpYnV0ZU1ldGhvZH0pYClcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgdHJhbnNsYXRlZCBhdHRyaWJ1dGUgd2l0aCBmYWxsYmFjay5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBOYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbG9jYWxlIC0gTG9jYWxlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIFRoZSB0cmFuc2xhdGVkIGF0dHJpYnV0ZSB3aXRoIGZhbGxiYWNrLCBpZiBmb3VuZC5cbiAgICovXG4gIF9nZXRUcmFuc2xhdGVkQXR0cmlidXRlV2l0aEZhbGxiYWNrKG5hbWUsIGxvY2FsZSkge1xuICAgIGxldCBsb2NhbGVzSW5PcmRlclxuICAgIGNvbnN0IGZhbGxiYWNrcyA9IHRoaXMuX2dldENvbmZpZ3VyYXRpb24oKS5nZXRMb2NhbGVGYWxsYmFja3MoKVxuXG4gICAgaWYgKGZhbGxiYWNrcyAmJiBsb2NhbGUgaW4gZmFsbGJhY2tzKSB7XG4gICAgICBsb2NhbGVzSW5PcmRlciA9IGZhbGxiYWNrc1tsb2NhbGVdXG4gICAgfSBlbHNlIHtcbiAgICAgIGxvY2FsZXNJbk9yZGVyID0gW2xvY2FsZV1cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGZhbGxiYWNrTG9jYWxlIG9mIGxvY2FsZXNJbk9yZGVyKSB7XG4gICAgICBjb25zdCByZXN1bHQgPSB0aGlzLl9nZXRUcmFuc2xhdGVkQXR0cmlidXRlKG5hbWUsIGZhbGxiYWNrTG9jYWxlKVxuXG4gICAgICBpZiAocmVzdWx0ICYmIHJlc3VsdC50cmltKCkgIT0gXCJcIikge1xuICAgICAgICByZXR1cm4gcmVzdWx0XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IHRyYW5zbGF0ZWQgYXR0cmlidXRlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIE5hbWUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBsb2NhbGUgLSBMb2NhbGUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IG5ld1ZhbHVlIC0gTmV3IHZhbHVlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfc2V0VHJhbnNsYXRlZEF0dHJpYnV0ZShuYW1lLCBsb2NhbGUsIG5ld1ZhbHVlKSB7XG4gICAgLyoqXG4gICAgICogRGVmaW5lcyB0cmFuc2xhdGlvbi5cbiAgICAgKiBAdHlwZSB7VmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQgfCBUcmFuc2xhdGlvbkJhc2UgfCB1bmRlZmluZWR9ICovXG4gICAgbGV0IHRyYW5zbGF0aW9uXG5cbiAgICB0cmFuc2xhdGlvbiA9IHRoaXMudHJhbnNsYXRpb25zTG9hZGVkKCk/LmZpbmQoKHRyYW5zbGF0aW9uKSA9PiB0cmFuc2xhdGlvbi5sb2NhbGUoKSA9PSBsb2NhbGUpXG5cbiAgICBpZiAoIXRyYW5zbGF0aW9uKSB7XG4gICAgICBjb25zdCBpbnN0YW5jZVJlbGF0aW9uc2hpcCA9IHRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKFwidHJhbnNsYXRpb25zXCIpXG5cbiAgICAgIHRyYW5zbGF0aW9uID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAuYnVpbGQoe2xvY2FsZX0pXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQXNzaWdubWVudHMuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCBhc3NpZ25tZW50cyA9IHt9XG5cbiAgICBhc3NpZ25tZW50c1tuYW1lXSA9IG5ld1ZhbHVlXG5cbiAgICB0cmFuc2xhdGlvbi5hc3NpZ24oYXNzaWdubWVudHMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBuZXcgcXVlcnkuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7e2RyaXZlcj86IGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0IHwgKCgpID0+IGltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0KSwgb3BlcmF0aW9uPzogaW1wb3J0KFwiLi4vb3BlcmF0aW9uLmpzXCIpLmRlZmF1bHR9fSBbYXJnc10gLSBFeHBsaWNpdCBxdWVyeSBvd25lcnNoaXAuXG4gICAqIEByZXR1cm5zIHtNb2RlbENsYXNzUXVlcnk8TUM+fSAtIFRoZSBuZXcgcXVlcnkuXG4gICAqL1xuICBzdGF0aWMgX25ld1F1ZXJ5KGFyZ3MgPSB7fSkge1xuICAgIGNvbnN0IHtkcml2ZXI6IGdpdmVuRHJpdmVyLCBvcGVyYXRpb246IGdpdmVuT3BlcmF0aW9uLCAuLi5yZXN0QXJnc30gPSBhcmdzXG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcbiAgICBjb25zdCBvcGVyYXRpb24gPSBnaXZlbk9wZXJhdGlvbiB8fCB0aGlzLl9yZWNvcmRNZXRhZGF0YU9wZXJhdGlvblxuICAgIGNvbnN0IGRyaXZlciA9IGdpdmVuRHJpdmVyIHx8IChvcGVyYXRpb24gPyBvcGVyYXRpb24uY29ubmVjdGlvbigpIDogKCkgPT4gdGhpcy5jb25uZWN0aW9uKCkpXG4gICAgdGhpcy5fYXNzZXJ0SGFzQmVlbkluaXRpYWxpemVkKClcbiAgICBjb25zdCBoYW5kbGVyID0gbmV3IEhhbmRsZXIoKVxuICAgIGNvbnN0IHF1ZXJ5ID0gbmV3IE1vZGVsQ2xhc3NRdWVyeSh7XG4gICAgICBkcml2ZXIsXG4gICAgICBoYW5kbGVyLFxuICAgICAgbW9kZWxDbGFzczogdGhpcyxcbiAgICAgIG9wZXJhdGlvblxuICAgIH0pXG5cbiAgICByZXR1cm4gcXVlcnkuZnJvbShuZXcgRnJvbVRhYmxlKHRoaXMudGFibGVOYW1lKCkpKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgb3JkZXJhYmxlIGNvbHVtbi5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgb3JkZXJhYmxlIGNvbHVtbi5cbiAgICovXG4gIHN0YXRpYyBvcmRlcmFibGVDb2x1bW4oKSB7XG4gICAgLy8gRklYTUU6IEFsbG93IHRvIGNoYW5nZSB0byAnY3JlYXRlZF9hdCcgaWYgdXNpbmcgVVVJRD9cblxuICAgIHJldHVybiB0aGlzLnByaW1hcnlLZXkoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWxsLlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcmV0dXJucyB7TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gLSBUaGUgYWxsLlxuICAgKi9cbiAgc3RhdGljIGFsbCgpIHtcbiAgICByZXR1cm4gdGhpcy5fbmV3UXVlcnkoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWNjZXNzaWJsZSBmb3IuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhY3Rpb24gLSBBYmlsaXR5IGFjdGlvbiB0byBzY29wZSBieS5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gW2FiaWxpdHldIC0gQWJpbGl0eSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge01vZGVsQ2xhc3NRdWVyeTxNQz59IC0gQXV0aG9yaXplZCBxdWVyeS5cbiAgICovXG4gIHN0YXRpYyBhY2Nlc3NpYmxlRm9yKGFjdGlvbiwgYWJpbGl0eSkge1xuICAgIGNvbnN0IHF1ZXJ5ID0gdGhpcy5fbmV3UXVlcnkoKVxuICAgIGNvbnN0IGN1cnJlbnRBYmlsaXR5ID0gYWJpbGl0eSB8fCBDdXJyZW50LmFiaWxpdHkoKVxuXG4gICAgaWYgKCFjdXJyZW50QWJpbGl0eSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBhYmlsaXR5IGluIGNvbnRleHQgZm9yICR7dGhpcy5uYW1lfS4gUGFzcyBhbiBhYmlsaXR5IG9yIGNvbmZpZ3VyZSBhYmlsaXR5IHJlc29sdmVyIG9uIHRoZSByZXF1ZXN0YClcbiAgICB9XG5cbiAgICByZXR1cm4gLyoqIEB0eXBlIHtNb2RlbENsYXNzUXVlcnk8TUM+fSAqLyAoY3VycmVudEFiaWxpdHkuYXBwbHlUb1F1ZXJ5KHtcbiAgICAgIGFjdGlvbixcbiAgICAgIG1vZGVsQ2xhc3M6IHRoaXMsXG4gICAgICBxdWVyeVxuICAgIH0pKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWNjZXNzaWJsZS5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gW2FiaWxpdHldIC0gQWJpbGl0eSBpbnN0YW5jZS5cbiAgICogQHJldHVybnMge01vZGVsQ2xhc3NRdWVyeTxNQz59IC0gQXV0aG9yaXplZCBxdWVyeS5cbiAgICovXG4gIHN0YXRpYyBhY2Nlc3NpYmxlKGFiaWxpdHkpIHtcbiAgICByZXR1cm4gdGhpcy5hY2Nlc3NpYmxlRm9yKFwicmVhZFwiLCBhYmlsaXR5KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYWNjZXNzaWJsZSBieS5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9hdXRob3JpemF0aW9uL2FiaWxpdHkuanNcIikuZGVmYXVsdH0gYWJpbGl0eSAtIEFiaWxpdHkgaW5zdGFuY2UuXG4gICAqIEByZXR1cm5zIHtNb2RlbENsYXNzUXVlcnk8TUM+fSAtIEF1dGhvcml6ZWQgcXVlcnkuXG4gICAqL1xuICBzdGF0aWMgYWNjZXNzaWJsZUJ5KGFiaWxpdHkpIHtcbiAgICBpZiAoIWFiaWxpdHkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gYWJpbGl0eSBwYXNzZWQgdG8gJHt0aGlzLm5hbWV9LmFjY2Vzc2libGVCeShhYmlsaXR5KS5gKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLmFjY2Vzc2libGUoYWJpbGl0eSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvdW50LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIFJlc29sdmVzIHdpdGggdGhlIGNvdW50LlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGNvdW50KCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlSW5pdGlhbGl6ZWQoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX25ld1F1ZXJ5KCkuY291bnQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ3JvdXAuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7c3RyaW5nfSBncm91cCAtIEdyb3VwLlxuICAgKiBAcmV0dXJucyB7TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gLSBUaGUgZ3JvdXAuXG4gICAqL1xuICBzdGF0aWMgZ3JvdXAoZ3JvdXApIHtcbiAgICByZXR1cm4gdGhpcy5fbmV3UXVlcnkoKS5ncm91cChncm91cClcbiAgfVxuXG4gIHN0YXRpYyBhc3luYyBkZXN0cm95QWxsKCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlSW5pdGlhbGl6ZWQoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX25ld1F1ZXJ5KCkuZGVzdHJveUFsbCgpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBwbHVjay5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHBhcmFtIHsuLi5zdHJpbmd8c3RyaW5nW119IGNvbHVtbnMgLSBDb2x1bW4gbmFtZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgcGx1Y2suXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgcGx1Y2soLi4uY29sdW1ucykge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlSW5pdGlhbGl6ZWQoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX25ld1F1ZXJ5KCkucGx1Y2soLi4uY29sdW1ucylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7bnVtYmVyfHN0cmluZ30gcmVjb3JkSWQgLSBSZWNvcmQgaWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxNQz4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGZpbmQuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZmluZChyZWNvcmRJZCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlSW5pdGlhbGl6ZWQoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX25ld1F1ZXJ5KCkuZmluZChyZWNvcmRJZClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgYnkuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7e1trZXk6IHN0cmluZ106IHN0cmluZyB8IG51bWJlcn19IGNvbmRpdGlvbnMgLSBDb25kaXRpb25zIGhhc2gga2V5ZWQgYnkgYXR0cmlidXRlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxNQz4gfCBudWxsPn0gLSBSZXNvbHZlcyB3aXRoIHRoZSBieS5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBmaW5kQnkoY29uZGl0aW9ucykge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlSW5pdGlhbGl6ZWQoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuX25ld1F1ZXJ5KCkuZmluZEJ5KGNvbmRpdGlvbnMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaW5kIGJ5IG9yIGZhaWwuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7e1trZXk6IHN0cmluZ106IHN0cmluZyB8IG51bWJlcn19IGNvbmRpdGlvbnMgLSBDb25kaXRpb25zIGhhc2gga2V5ZWQgYnkgYXR0cmlidXRlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxNQz4+fSAtIFJlc29sdmVzIHdpdGggdGhlIGJ5IG9yIGZhaWwuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZmluZEJ5T3JGYWlsKGNvbmRpdGlvbnMpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9uZXdRdWVyeSgpLmZpbmRCeU9yRmFpbChjb25kaXRpb25zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgYW4gaW1tdXRhYmxlIHRlbmFudC1ib3VuZCBtb2RlbCBzY29wZS4gRWFnZXIgaGVscGVycyBhbmQgZXhwbGljaXRcbiAgICogZGF0YWJhc2VPcGVyYXRpb24vdHJhbnNhY3Rpb24gY2FsbGJhY2tzIGV4ZWN1dGUgZnJvbSBhIGNhcHR1cmVkIHBoeXNpY2FsXG4gICAqIGRhdGFiYXNlIGNvbmZpZ3VyYXRpb24gaW5zdGVhZCBvZiBhbWJpZW50IHRlbmFudCBzdGF0ZS5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHBhcmFtIHtvYmplY3R9IHRlbmFudCAtIE9yZGluYXJ5IG9yIG51bGwtcHJvdG90eXBlIEpTT04tY29tcGF0aWJsZSB0ZW5hbnQgZGVzY3JpcHRvciB0byBzY29wZSB0aGUgbW9kZWwgdG8uXG4gICAqIEByZXR1cm5zIHtUZW5hbnRNb2RlbFNjb3BlPE1DPn0gLSBNb2RlbCBzY29wZSBib3VuZCB0byB0aGUgY2FwdHVyZWQgdGVuYW50IGRhdGFiYXNlLlxuICAgKi9cbiAgc3RhdGljIHVzaW5nVGVuYW50KHRlbmFudCkge1xuICAgIHJldHVybiBuZXcgVGVuYW50TW9kZWxTY29wZSh7XG4gICAgICBjb25maWd1cmF0aW9uOiB0aGlzLl9nZXRDb25maWd1cmF0aW9uKCksXG4gICAgICBtb2RlbENsYXNzOiB0aGlzLFxuICAgICAgdGVuYW50XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgb3IgY3JlYXRlIGJ5LlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge3tba2V5OiBzdHJpbmddOiBzdHJpbmcgfCBudW1iZXJ9fSBjb25kaXRpb25zIC0gQ29uZGl0aW9ucyBoYXNoIGtleWVkIGJ5IGF0dHJpYnV0ZSBuYW1lLlxuICAgKiBAcGFyYW0geygpID0+IHZvaWR9IFtjYWxsYmFja10gLSBDYWxsYmFjayBmdW5jdGlvbi5cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPE1DPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgb3IgY3JlYXRlIGJ5LlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIGZpbmRPckNyZWF0ZUJ5KGNvbmRpdGlvbnMsIGNhbGxiYWNrKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fbmV3UXVlcnkoKS5maW5kT3JDcmVhdGVCeShjb25kaXRpb25zLCBjYWxsYmFjaylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGZpbmQgb3IgaW5pdGlhbGl6ZSBieS5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudW1iZXI+fSBjb25kaXRpb25zIC0gQ29uZGl0aW9ucy5cbiAgICogQHBhcmFtIHsoYXJnOiBJbnN0YW5jZVR5cGU8TUM+KSA9PiB2b2lkfSBbY2FsbGJhY2tdIC0gQ2FsbGJhY2sgZnVuY3Rpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxNQz4+fSAtIFJlc29sdmVzIHdpdGggdGhlIG9yIGluaXRpYWxpemUgYnkuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZmluZE9ySW5pdGlhbGl6ZUJ5KGNvbmRpdGlvbnMsIGNhbGxiYWNrKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fbmV3UXVlcnkoKS5maW5kT3JJbml0aWFsaXplQnkoY29uZGl0aW9ucywgY2FsbGJhY2spXG4gIH1cblxuICAvKipcbiAgICogUnVucyBmaXJzdC5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPE1DPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgZmlyc3QuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgZmlyc3QoKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpXG5cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLl9uZXdRdWVyeSgpLmZpcnN0KClcblxuICAgIGlmICghcmVzdWx0KSB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5uYW1lfS5maXJzdCgpIHJldHVybmVkIG5vIHJlY29yZHNgKVxuXG4gICAgcmV0dXJuIHJlc3VsdFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgam9pbnMuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgaW1wb3J0KFwiLi4vcXVlcnkvam9pbi1vYmplY3QuanNcIikuSm9pbk9iamVjdH0gam9pbiAtIEpvaW4gY2xhdXNlIG9yIGpvaW4gZGVzY3JpcHRvci5cbiAgICogQHJldHVybnMge01vZGVsQ2xhc3NRdWVyeTxNQz59IC0gVGhlIGpvaW5zLlxuICAgKi9cbiAgc3RhdGljIGpvaW5zKGpvaW4pIHtcbiAgICByZXR1cm4gdGhpcy5fbmV3UXVlcnkoKS5qb2lucyhqb2luKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbGFzdC5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHJldHVybnMge1Byb21pc2U8SW5zdGFuY2VUeXBlPE1DPj59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgbGFzdC5cbiAgICovXG4gIHN0YXRpYyBhc3luYyBsYXN0KCkge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlSW5pdGlhbGl6ZWQoKVxuXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5fbmV3UXVlcnkoKS5sYXN0KClcblxuICAgIGlmICghcmVzdWx0KSB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5uYW1lfS5sYXN0KCkgcmV0dXJuZWQgbm8gcmVjb3Jkc2ApXG5cbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cblxuICAvKipcbiAgICogUnVucyBsaW1pdC5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHBhcmFtIHtudW1iZXJ9IHZhbHVlIC0gVmFsdWUgdG8gdXNlLlxuICAgKiBAcmV0dXJucyB7TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gLSBUaGUgbGltaXQuXG4gICAqL1xuICBzdGF0aWMgbGltaXQodmFsdWUpIHtcbiAgICByZXR1cm4gdGhpcy5fbmV3UXVlcnkoKS5saW1pdCh2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG9yZGVyLlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3F1ZXJ5L2luZGV4LmpzXCIpLk9yZGVyQXJndW1lbnRUeXBlfSBvcmRlciAtIE9yZGVyLlxuICAgKiBAcmV0dXJucyB7TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gLSBUaGUgb3JkZXIuXG4gICAqL1xuICBzdGF0aWMgb3JkZXIob3JkZXIpIHtcbiAgICByZXR1cm4gdGhpcy5fbmV3UXVlcnkoKS5vcmRlcihvcmRlcilcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRpc3RpbmN0LlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IFt2YWx1ZV0gLSBWYWx1ZSB0byB1c2UuXG4gICAqIEByZXR1cm5zIHtNb2RlbENsYXNzUXVlcnk8TUM+fSAtIFRoZSBkaXN0aW5jdC5cbiAgICovXG4gIHN0YXRpYyBkaXN0aW5jdCh2YWx1ZSA9IHRydWUpIHtcbiAgICByZXR1cm4gdGhpcy5fbmV3UXVlcnkoKS5kaXN0aW5jdCh2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHByZWxvYWQuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vcXVlcnkvaW5kZXguanNcIikuTmVzdGVkUHJlbG9hZFJlY29yZCB8IHN0cmluZyB8IEFycmF5PHN0cmluZyB8IGltcG9ydChcIi4uL3F1ZXJ5L2luZGV4LmpzXCIpLk5lc3RlZFByZWxvYWRSZWNvcmQ+fSBwcmVsb2FkIC0gUHJlbG9hZC5cbiAgICogQHJldHVybnMge01vZGVsQ2xhc3NRdWVyeTxNQz59IC0gVGhlIHByZWxvYWQuXG4gICAqL1xuICBzdGF0aWMgcHJlbG9hZChwcmVsb2FkKSB7XG4gICAgY29uc3QgcXVlcnkgPSAvKiogQHR5cGUge01vZGVsQ2xhc3NRdWVyeTxNQz59ICovICh0aGlzLl9uZXdRdWVyeSgpLnByZWxvYWQocHJlbG9hZCkpXG5cbiAgICByZXR1cm4gcXVlcnlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHNlbGVjdC5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9xdWVyeS9pbmRleC5qc1wiKS5TZWxlY3RBcmd1bWVudFR5cGV9IHNlbGVjdCAtIFNlbGVjdC5cbiAgICogQHJldHVybnMge01vZGVsQ2xhc3NRdWVyeTxNQz59IC0gVGhlIHNlbGVjdC5cbiAgICovXG4gIHN0YXRpYyBzZWxlY3Qoc2VsZWN0KSB7XG4gICAgcmV0dXJuIHRoaXMuX25ld1F1ZXJ5KCkuc2VsZWN0KHNlbGVjdClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHRvIGFycmF5LlxuICAgKiBAdGVtcGxhdGUge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTUNcbiAgICogQHRoaXMge01DfVxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxJbnN0YW5jZVR5cGU8TUM+W10+fSAtIFJlc29sdmVzIHdpdGggdGhlIGFycmF5LlxuICAgKi9cbiAgc3RhdGljIGFzeW5jIHRvQXJyYXkoKSB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVJbml0aWFsaXplZCgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fbmV3UXVlcnkoKS50b0FycmF5KClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGxvYWQuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEByZXR1cm5zIHtQcm9taXNlPEluc3RhbmNlVHlwZTxNQz5bXT59IC0gUmVzb2x2ZXMgd2l0aCB0aGUgYXJyYXkuXG4gICAqL1xuICBzdGF0aWMgYXN5bmMgbG9hZCgpIHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZUluaXRpYWxpemVkKClcblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9uZXdRdWVyeSgpLmxvYWQoKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2hlcmUuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAdGhpcyB7TUN9XG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vcXVlcnkvaW5kZXguanNcIikuV2hlcmVBcmd1bWVudFR5cGV9IHdoZXJlIC0gV2hlcmUuXG4gICAqIEByZXR1cm5zIHtNb2RlbENsYXNzUXVlcnk8TUM+fSAtIFRoZSB3aGVyZS5cbiAgICovXG4gIHN0YXRpYyB3aGVyZSh3aGVyZSkge1xuICAgIHJldHVybiB0aGlzLl9uZXdRdWVyeSgpLndoZXJlKHdoZXJlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmFuc2Fjay5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEB0aGlzIHtNQ31cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IHBhcmFtcyAtIFJhbnNhY2stc3R5bGUgcGFyYW1zIGhhc2guXG4gICAqIEByZXR1cm5zIHtNb2RlbENsYXNzUXVlcnk8TUM+fSAtIFF1ZXJ5IHdpdGggUmFuc2FjayBmaWx0ZXJzIGFwcGxpZWQuXG4gICAqL1xuICBzdGF0aWMgcmFuc2FjayhwYXJhbXMpIHtcbiAgICByZXR1cm4gdGhpcy5fbmV3UXVlcnkoKS5yYW5zYWNrKHBhcmFtcylcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGNvbnN0cnVjdG9yLlxuICAgKiBAcGFyYW0ge1dyaXRlQXR0cmlidXRlc30gY2hhbmdlcyAtIENoYW5nZXMuXG4gICAqL1xuICBjb25zdHJ1Y3RvcihjaGFuZ2VzID0gLyoqIEB0eXBlIHtXcml0ZUF0dHJpYnV0ZXN9ICovICh7fSkpIHtcbiAgICBjb25zdCBNb2RlbENsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9ICovIChuZXcudGFyZ2V0KVxuXG4gICAgdGhpcy5fZGF0YWJhc2VPcGVyYXRpb24gPSBNb2RlbENsYXNzLl9yZWNvcmRNZXRhZGF0YU9wZXJhdGlvblxuICAgIHRoaXMuZ2V0TW9kZWxDbGFzcygpLl9hc3NlcnRIYXNCZWVuSW5pdGlhbGl6ZWQoKVxuICAgIHRoaXMuX2F0dHJpYnV0ZXMgPSB7fVxuICAgIHRoaXMuX2NoYW5nZXMgPSB7fVxuICAgIHRoaXMuX2lzTmV3UmVjb3JkID0gdHJ1ZVxuXG4gICAgZm9yIChjb25zdCBrZXkgaW4gY2hhbmdlcykge1xuICAgICAgdGhpcy5zZXRBdHRyaWJ1dGUoa2V5LCBjaGFuZ2VzW2tleV0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEJpbmRzIGZ1dHVyZSBxdWVyeSwgbGlmZWN5Y2xlLCByZWxhdGlvbnNoaXAsIGFuZCBwZXJzaXN0ZW5jZSB3b3JrIHRvIGFuIG9wZXJhdGlvbi5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9vcGVyYXRpb24uanNcIikuZGVmYXVsdH0gb3BlcmF0aW9uIC0gT3duaW5nIG9wZXJhdGlvbi5cbiAgICogQHJldHVybnMge3RoaXN9IC0gQm91bmQgcmVjb3JkLlxuICAgKi9cbiAgYmluZERhdGFiYXNlT3BlcmF0aW9uKG9wZXJhdGlvbikge1xuICAgIGlmICh0aGlzLl9kYXRhYmFzZU9wZXJhdGlvbiAmJiB0aGlzLl9kYXRhYmFzZU9wZXJhdGlvbiAhPT0gb3BlcmF0aW9uKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZWNvcmQgaXMgYWxyZWFkeSBib3VuZCB0byBhbm90aGVyIGRhdGFiYXNlIG9wZXJhdGlvblwiKVxuICAgIH1cblxuICAgIHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uID0gb3BlcmF0aW9uXG5cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIENhcHR1cmVzIGFuZCB2YWxpZGF0ZXMgdGhlIHBoeXNpY2FsIGRhdGFiYXNlIGlkZW50aXR5IHRoYXQgb3ducyB0aGlzIHJlY29yZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGRhdGFiYXNlSWRlbnRpdHkgLSBPcGFxdWUgb3BlcmF0aW9uL2Nvbm5lY3Rpb24gaWRlbnRpdHkuXG4gICAqIEByZXR1cm5zIHt0aGlzfSBUaGlzIHJlY29yZC5cbiAgICovXG4gIGNhcHR1cmVEYXRhYmFzZUlkZW50aXR5KGRhdGFiYXNlSWRlbnRpdHkpIHtcbiAgICBpZiAodGhpcy5fZGF0YWJhc2VJZGVudGl0eSAmJiB0aGlzLl9kYXRhYmFzZUlkZW50aXR5ICE9PSBkYXRhYmFzZUlkZW50aXR5KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZWNvcmQgYmVsb25ncyB0byBhIGRpZmZlcmVudCBwaHlzaWNhbCB0ZW5hbnQgZGF0YWJhc2VcIilcbiAgICB9XG5cbiAgICB0aGlzLl9kYXRhYmFzZUlkZW50aXR5ID0gZGF0YWJhc2VJZGVudGl0eVxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBjYXB0dXJlZCBwaHlzaWNhbCBkYXRhYmFzZSBpZGVudGl0eS5cbiAgICogQHJldHVybnMge3N0cmluZyB8IHVuZGVmaW5lZH0gQ2FwdHVyZWQgcGh5c2ljYWwgZGF0YWJhc2UgaWRlbnRpdHkuXG4gICAqL1xuICBkYXRhYmFzZUlkZW50aXR5KCkge1xuICAgIHJldHVybiB0aGlzLl9kYXRhYmFzZUlkZW50aXR5XG4gIH1cblxuICAvKipcbiAgICogUmVsZWFzZXMgdGhpcyByZWNvcmQgZnJvbSBhIGNvbXBsZXRlZCBlYWdlci1oZWxwZXIgb3BlcmF0aW9uIHdoaWxlXG4gICAqIHByZXNlcnZpbmcgdGhlIGxlZ2FjeSBhbWJpZW50IGZvbGxvdy11cCBiZWhhdmlvciBvZiBgdXNpbmdUZW5hbnRgIGZpbmRlcnMuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vb3BlcmF0aW9uLmpzXCIpLmRlZmF1bHR9IG9wZXJhdGlvbiAtIFJlbGVhc2luZyBvcGVyYXRpb24uXG4gICAqIEByZXR1cm5zIHt0aGlzfSAtIFJlY29yZC5cbiAgICovXG4gIHJlbGVhc2VEYXRhYmFzZU9wZXJhdGlvbihvcGVyYXRpb24pIHtcbiAgICBpZiAodGhpcy5fZGF0YWJhc2VPcGVyYXRpb24gIT09IG9wZXJhdGlvbikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUmVjb3JkIGlzIG5vdCBib3VuZCB0byB0aGUgcmVsZWFzaW5nIGRhdGFiYXNlIG9wZXJhdGlvblwiKVxuICAgIH1cblxuICAgIHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uID0gdW5kZWZpbmVkXG5cbiAgICByZXR1cm4gdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGV4cGxpY2l0IG9wZXJhdGlvbiBvd25pbmcgdGhpcyByZWNvcmQsIGlmIGFueS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL29wZXJhdGlvbi5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIE93bmluZyBvcGVyYXRpb24uXG4gICAqL1xuICBkYXRhYmFzZU9wZXJhdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5fZGF0YWJhc2VPcGVyYXRpb25cbiAgfVxuXG4gIC8qKlxuICAgKiBCaW5kcyBhIHJlbGF0ZWQgcmVjb3JkIHRvIHRoZSBzYW1lIG9wZXJhdGlvbiBhcyB0aGlzIHJlY29yZC5cbiAgICogQHRlbXBsYXRlIHtWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gTW9kZWxcbiAgICogQHBhcmFtIHtNb2RlbH0gcmVjb3JkIC0gUmVsYXRlZCByZWNvcmQuXG4gICAqIEByZXR1cm5zIHtNb2RlbH0gLSBSZWxhdGVkIHJlY29yZC5cbiAgICovXG4gIGJpbmRSZWxhdGVkUmVjb3JkKHJlY29yZCkge1xuICAgIGlmICh0aGlzLl9kYXRhYmFzZU9wZXJhdGlvbikgdGhpcy5fZGF0YWJhc2VPcGVyYXRpb24uYmluZFJlY29yZChyZWNvcmQpXG5cbiAgICByZXR1cm4gcmVjb3JkXG4gIH1cblxuICAvKipcbiAgICogQnVpbGRzIGEgbW9kZWwgcXVlcnkgcHJlc2VydmluZyB0aGlzIHJlY29yZCdzIG9wZXJhdGlvbiBvd25lcnNoaXAuXG4gICAqIEB0ZW1wbGF0ZSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNQ1xuICAgKiBAcGFyYW0ge01DfSBNb2RlbENsYXNzIC0gVGFyZ2V0IG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7TW9kZWxDbGFzc1F1ZXJ5PE1DPn0gLSBUYXJnZXQgcXVlcnkuXG4gICAqL1xuICBxdWVyeUZvck1vZGVsKE1vZGVsQ2xhc3MpIHtcbiAgICBpZiAodGhpcy5fZGF0YWJhc2VPcGVyYXRpb24pIHJldHVybiB0aGlzLl9kYXRhYmFzZU9wZXJhdGlvbi5mb3JNb2RlbChNb2RlbENsYXNzKVxuXG4gICAgcmV0dXJuIE1vZGVsQ2xhc3MuX25ld1F1ZXJ5KClcbiAgfVxuXG4gIC8qKlxuICAgKiBJbml0aWFsaXplcyBhIHJlbGF0aW9uc2hpcC9wcmVsb2FkIHRhcmdldCB3aXRob3V0IGRyb3BwaW5nIHRoaXMgcmVjb3JkJ3NcbiAgICogZXhwbGljaXQgb3BlcmF0aW9uIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBNb2RlbENsYXNzIC0gVGFyZ2V0IG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gY29uZmlndXJhdGlvbiAtIE93bmluZyBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGluaXRpYWxpemVkLlxuICAgKi9cbiAgYXN5bmMgZW5zdXJlTW9kZWxDbGFzc0luaXRpYWxpemVkKE1vZGVsQ2xhc3MsIGNvbmZpZ3VyYXRpb24pIHtcbiAgICBpZiAodGhpcy5fZGF0YWJhc2VPcGVyYXRpb24pIHtcbiAgICAgIGF3YWl0IHRoaXMuX2RhdGFiYXNlT3BlcmF0aW9uLmVuc3VyZU1vZGVsSW5pdGlhbGl6ZWQoTW9kZWxDbGFzcylcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IE1vZGVsQ2xhc3MuZW5zdXJlSW5pdGlhbGl6ZWQoe2NvbmZpZ3VyYXRpb259KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbG9hZCBleGlzdGluZyByZWNvcmQuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhdHRyaWJ1dGVzIC0gQXR0cmlidXRlcy5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgbG9hZEV4aXN0aW5nUmVjb3JkKGF0dHJpYnV0ZXMpIHtcbiAgICB0aGlzLl9hdHRyaWJ1dGVzID0gYXR0cmlidXRlc1xuICAgIHRoaXMuX2lzTmV3UmVjb3JkID0gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBBc3NpZ25zIHRoZSBnaXZlbiBhdHRyaWJ1dGVzIHRvIHRoZSByZWNvcmQuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBhdHRyaWJ1dGVzVG9Bc3NpZ24gLSBBdHRyaWJ1dGVzIHRvIGFzc2lnbi5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgYXNzaWduKGF0dHJpYnV0ZXNUb0Fzc2lnbikge1xuICAgIHRoaXMuX2Fzc2lnbmVkQXR0cmlidXRlTmFtZXMgfHw9IG5ldyBTZXQoKVxuICAgIGZvciAoY29uc3QgYXR0cmlidXRlVG9Bc3NpZ24gaW4gYXR0cmlidXRlc1RvQXNzaWduKSB7XG4gICAgICB0aGlzLl9hc3NpZ25lZEF0dHJpYnV0ZU5hbWVzLmFkZChhdHRyaWJ1dGVUb0Fzc2lnbilcbiAgICAgIHRoaXMuc2V0QXR0cmlidXRlKGF0dHJpYnV0ZVRvQXNzaWduLCBhdHRyaWJ1dGVzVG9Bc3NpZ25bYXR0cmlidXRlVG9Bc3NpZ25dKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGEgdGhlIGN1cnJlbnQgYXR0cmlidXRlcyBvZiB0aGUgcmVjb3JkIChvcmlnaW5hbCBhdHRyaWJ1dGVzIGZyb20gZGF0YWJhc2UgcGx1cyBjaGFuZ2VzKVxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFRoZSBhdHRyaWJ1dGVzLlxuICAgKi9cbiAgYXR0cmlidXRlcygpIHtcbiAgICBjb25zdCBkYXRhID0gdGhpcy5yYXdBdHRyaWJ1dGVzKClcbiAgICBjb25zdCBjb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lID0gdGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCgpXG4gICAgLyoqXG4gICAgICogQXR0cmlidXRlcy5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGF0dHJpYnV0ZXMgPSB7fVxuXG4gICAgZm9yIChjb25zdCBjb2x1bW5OYW1lIGluIGRhdGEpIHtcbiAgICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWUgPSBjb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lW2NvbHVtbk5hbWVdIHx8IGNvbHVtbk5hbWVcblxuICAgICAgYXR0cmlidXRlc1thdHRyaWJ1dGVOYW1lXSA9IHRoaXMucmVhZEF0dHJpYnV0ZShhdHRyaWJ1dGVOYW1lKVxuICAgIH1cblxuICAgIHJldHVybiBhdHRyaWJ1dGVzXG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBjb2x1bW4tbmFtZSBrZXllZCBkYXRhIChvcmlnaW5hbCBhdHRyaWJ1dGVzIGZyb20gZGF0YWJhc2UgcGx1cyBjaGFuZ2VzKVxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFRoZSByYXcgYXR0cmlidXRlcy5cbiAgICovXG4gIHJhd0F0dHJpYnV0ZXMoKSB7XG4gICAgcmV0dXJuIE9iamVjdC5hc3NpZ24oe30sIHRoaXMuX2F0dHJpYnV0ZXMsIHRoaXMuX2NoYW5nZXMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IC0gVGhlIGNvbm5lY3Rpb24uXG4gICAqL1xuICBfY29ubmVjdGlvbigpIHtcbiAgICBpZiAodGhpcy5fZGF0YWJhc2VPcGVyYXRpb24pIHJldHVybiB0aGlzLl9kYXRhYmFzZU9wZXJhdGlvbi5jb25uZWN0aW9uKClcbiAgICBpZiAodGhpcy5fX2Nvbm5lY3Rpb24pIHJldHVybiB0aGlzLl9fY29ubmVjdGlvblxuXG4gICAgY29uc3QgY29ubmVjdGlvbiA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmNvbm5lY3Rpb24oKVxuXG4gICAgaWYgKHRoaXMuX2RhdGFiYXNlSWRlbnRpdHkpIHRoaXMuY2FwdHVyZURhdGFiYXNlSWRlbnRpdHkodGhpcy5fZGF0YWJhc2VJZGVudGl0eUZvckNvbm5lY3Rpb24oY29ubmVjdGlvbikpXG5cbiAgICByZXR1cm4gY29ubmVjdGlvblxuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBpZGVudGl0eSBvZiBhbiBhbHJlYWR5IHNlbGVjdGVkIGNvbmNyZXRlIGNvbm5lY3Rpb24uXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBDb25jcmV0ZSBjb25uZWN0aW9uLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSBQaHlzaWNhbCBkYXRhYmFzZSBpZGVudGl0eS5cbiAgICovXG4gIF9kYXRhYmFzZUlkZW50aXR5Rm9yQ29ubmVjdGlvbihjb25uZWN0aW9uKSB7XG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpXG4gICAgY29uc3QgZGF0YWJhc2VJZGVudGlmaWVyID0gbW9kZWxDbGFzcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKVxuICAgIGNvbnN0IHJldXNlS2V5ID0gbW9kZWxDbGFzc1xuICAgICAgLl9nZXRDb25maWd1cmF0aW9uKClcbiAgICAgIC5nZXREYXRhYmFzZVBvb2woZGF0YWJhc2VJZGVudGlmaWVyKVxuICAgICAgLmdldENvbm5lY3Rpb25Db25maWd1cmF0aW9uUmV1c2VLZXkoY29ubmVjdGlvbilcblxuICAgIHJldHVybiBgJHtkYXRhYmFzZUlkZW50aWZpZXJ9OiR7cmV1c2VLZXl9YFxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdGhlIGNvbm5lY3Rpb24gdGhhdCBvd25zIHRoaXMgcmVjb3JkJ3MgZGF0YWJhc2Ugd29yay5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSAtIENvbm5lY3Rpb24uXG4gICAqL1xuICBjb25uZWN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLl9jb25uZWN0aW9uKClcbiAgfVxuXG4gIC8qKlxuICAgKiBDb3VudHMgZGVwZW5kZW50IHJlY29yZHMgZm9yIGEgYGRlcGVuZGVudDogXCJyZXN0cmljdFwiYCByZWxhdGlvbnNoaXAuXG4gICAqIEBwYXJhbSB7UmVzdHJpY3RJbnN0YW5jZVJlbGF0aW9uc2hpcH0gaW5zdGFuY2VSZWxhdGlvbnNoaXAgLSBSZWxhdGlvbnNoaXAgaW5zdGFuY2UgdG8gY291bnQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gRGVwZW5kZW50IHJvdyBjb3VudC5cbiAgICovXG4gIGFzeW5jIF9kZXBlbmRlbnRSZXN0cmljdENvdW50KGluc3RhbmNlUmVsYXRpb25zaGlwKSB7XG4gICAgY29uc3QgVGFyZ2V0TW9kZWxDbGFzcyA9IGluc3RhbmNlUmVsYXRpb25zaGlwLmdldFRhcmdldE1vZGVsQ2xhc3MoKVxuXG4gICAgaWYgKCFUYXJnZXRNb2RlbENsYXNzIHx8ICFUYXJnZXRNb2RlbENsYXNzLmhhc1RlbmFudERhdGFiYXNlSWRlbnRpZmllclJlc29sdmVyKCkpIHtcbiAgICAgIHJldHVybiBhd2FpdCBpbnN0YW5jZVJlbGF0aW9uc2hpcC5xdWVyeSgpLmNvdW50KClcbiAgICB9XG5cbiAgICBpZiAodGhpcy5nZXRNb2RlbENsYXNzKCkuaGFzVGVuYW50RGF0YWJhc2VJZGVudGlmaWVyUmVzb2x2ZXIoKSkge1xuICAgICAgcmV0dXJuIGF3YWl0IGluc3RhbmNlUmVsYXRpb25zaGlwLnF1ZXJ5KCkuY291bnQoKVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCB0aGlzLl9kZXBlbmRlbnRSZXN0cmljdFRlbmFudENvdW50KGluc3RhbmNlUmVsYXRpb25zaGlwLCBUYXJnZXRNb2RlbENsYXNzKVxuICB9XG5cbiAgLyoqXG4gICAqIENvdW50cyB0ZW5hbnQtc2NvcGVkIGRlcGVuZGVudCByZWNvcmRzIGFjcm9zcyBhbGwgcHJvdmlkZXItbGlzdGVkIHRlbmFudHMuXG4gICAqIEBwYXJhbSB7UmVzdHJpY3RJbnN0YW5jZVJlbGF0aW9uc2hpcH0gaW5zdGFuY2VSZWxhdGlvbnNoaXAgLSBSZWxhdGlvbnNoaXAgaW5zdGFuY2UgdG8gY291bnQuXG4gICAqIEBwYXJhbSB7dHlwZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkfSBUYXJnZXRNb2RlbENsYXNzIC0gUmVsYXRlZCBtb2RlbCBjbGFzcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBEZXBlbmRlbnQgcm93IGNvdW50LlxuICAgKi9cbiAgYXN5bmMgX2RlcGVuZGVudFJlc3RyaWN0VGVuYW50Q291bnQoaW5zdGFuY2VSZWxhdGlvbnNoaXAsIFRhcmdldE1vZGVsQ2xhc3MpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gdGhpcy5nZXRNb2RlbENsYXNzKCkuX2dldENvbmZpZ3VyYXRpb24oKVxuICAgIGNvbnN0IHRlbmFudERhdGFiYXNlUHJvdmlkZXJzID0gY29uZmlndXJhdGlvbi5nZXRUZW5hbnREYXRhYmFzZVByb3ZpZGVycygpXG4gICAgY29uc3QgcHJvdmlkZXJFbnRyaWVzID0gT2JqZWN0LmVudHJpZXModGVuYW50RGF0YWJhc2VQcm92aWRlcnMpXG4gICAgY29uc3QgdGFyZ2V0SWRlbnRpZmllciA9IFRhcmdldE1vZGVsQ2xhc3MuZ2V0VGVuYW50RGF0YWJhc2VJZGVudGlmaWVyKG51bGwpXG5cbiAgICBpZiAocHJvdmlkZXJFbnRyaWVzLmxlbmd0aCA9PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBjaGVjayBkZXBlbmRlbnQgJHtpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRSZWxhdGlvbnNoaXAoKS5nZXRSZWxhdGlvbnNoaXBOYW1lKCl9IGJlY2F1c2UgJHtUYXJnZXRNb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpfSBzd2l0Y2hlcyB0ZW5hbnQgZGF0YWJhc2VzIGJ1dCBubyB0ZW5hbnQgZGF0YWJhc2UgcHJvdmlkZXJzIGFyZSBjb25maWd1cmVkYClcbiAgICB9XG5cbiAgICBpZiAodGFyZ2V0SWRlbnRpZmllcikge1xuICAgICAgY29uc3QgcHJvdmlkZXIgPSB0ZW5hbnREYXRhYmFzZVByb3ZpZGVyc1t0YXJnZXRJZGVudGlmaWVyXVxuXG4gICAgICBpZiAoIXByb3ZpZGVyKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IGNoZWNrIGRlcGVuZGVudCAke2luc3RhbmNlUmVsYXRpb25zaGlwLmdldFJlbGF0aW9uc2hpcCgpLmdldFJlbGF0aW9uc2hpcE5hbWUoKX0gYmVjYXVzZSAke1RhcmdldE1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCl9IHN3aXRjaGVzIHRlbmFudCBkYXRhYmFzZSAke3RhcmdldElkZW50aWZpZXJ9IGJ1dCBubyB0ZW5hbnQgZGF0YWJhc2UgcHJvdmlkZXIgaXMgY29uZmlndXJlZCBmb3IgJHt0YXJnZXRJZGVudGlmaWVyfWApXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLl9kZXBlbmRlbnRSZXN0cmljdFByb3ZpZGVyQ291bnQoaW5zdGFuY2VSZWxhdGlvbnNoaXAsIFRhcmdldE1vZGVsQ2xhc3MsIHRhcmdldElkZW50aWZpZXIsIHByb3ZpZGVyKVxuICAgIH1cblxuICAgIGxldCBtYXRjaGluZ1Byb3ZpZGVyU2VlbiA9IGZhbHNlXG5cbiAgICBmb3IgKGNvbnN0IFtpZGVudGlmaWVyLCBwcm92aWRlcl0gb2YgcHJvdmlkZXJFbnRyaWVzKSB7XG4gICAgICBjb25zdCB0ZW5hbnRzID0gYXdhaXQgdGhpcy5fZGVwZW5kZW50UmVzdHJpY3RQcm92aWRlclRlbmFudHMoaW5zdGFuY2VSZWxhdGlvbnNoaXAsIFRhcmdldE1vZGVsQ2xhc3MsIGlkZW50aWZpZXIsIHByb3ZpZGVyKVxuXG4gICAgICBmb3IgKGNvbnN0IHRlbmFudCBvZiB0ZW5hbnRzKSB7XG4gICAgICAgIGlmIChUYXJnZXRNb2RlbENsYXNzLmdldFRlbmFudERhdGFiYXNlSWRlbnRpZmllcih0ZW5hbnQpICE9IGlkZW50aWZpZXIpIHtcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9XG5cbiAgICAgICAgbWF0Y2hpbmdQcm92aWRlclNlZW4gPSB0cnVlXG5cbiAgICAgICAgY29uc3QgY291bnQgPSBhd2FpdCBjb25maWd1cmF0aW9uLnJ1bldpdGhUZW5hbnQodGVuYW50LCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgaWYgKCFjb25maWd1cmF0aW9uLmlzRGF0YWJhc2VJZGVudGlmaWVyQWN0aXZlKGlkZW50aWZpZXIpKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFRlbmFudCBkYXRhYmFzZSBpZGVudGlmaWVyICR7aWRlbnRpZmllcn0gaXMgaW5hY3RpdmUgd2hpbGUgY2hlY2tpbmcgZGVwZW5kZW50ICR7aW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0UmVsYXRpb25zaGlwKCkuZ2V0UmVsYXRpb25zaGlwTmFtZSgpfWApXG4gICAgICAgICAgfVxuXG4gICAgICAgICAgcmV0dXJuIGF3YWl0IGNvbmZpZ3VyYXRpb24uZW5zdXJlQ29ubmVjdGlvbnMoe2RhdGFiYXNlSWRlbnRpZmllcnM6IFtpZGVudGlmaWVyXSwgbmFtZTogYERlcGVuZGVudCByZXN0cmljdCBjb3VudDogJHtUYXJnZXRNb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpfWB9LCBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICByZXR1cm4gYXdhaXQgaW5zdGFuY2VSZWxhdGlvbnNoaXAucXVlcnkoKS5jb3VudCgpXG4gICAgICAgICAgfSlcbiAgICAgICAgfSlcblxuICAgICAgICBpZiAoY291bnQgPiAwKSByZXR1cm4gY291bnRcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIW1hdGNoaW5nUHJvdmlkZXJTZWVuKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBjaGVjayBkZXBlbmRlbnQgJHtpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRSZWxhdGlvbnNoaXAoKS5nZXRSZWxhdGlvbnNoaXBOYW1lKCl9IGJlY2F1c2Ugbm8gdGVuYW50IGRhdGFiYXNlIHByb3ZpZGVyIG1hdGNoZWQgJHtUYXJnZXRNb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpfWApXG4gICAgfVxuXG4gICAgcmV0dXJuIDBcbiAgfVxuXG4gIC8qKlxuICAgKiBDb3VudHMgdGVuYW50LXNjb3BlZCBkZXBlbmRlbnQgcmVjb3JkcyBmb3Igb25lIGNvbmZpZ3VyZWQgdGVuYW50IHByb3ZpZGVyLlxuICAgKiBAcGFyYW0ge1Jlc3RyaWN0SW5zdGFuY2VSZWxhdGlvbnNoaXB9IGluc3RhbmNlUmVsYXRpb25zaGlwIC0gUmVsYXRpb25zaGlwIGluc3RhbmNlIHRvIGNvdW50LlxuICAgKiBAcGFyYW0ge3R5cGVvZiBWZWxvY2lvdXNEYXRhYmFzZVJlY29yZH0gVGFyZ2V0TW9kZWxDbGFzcyAtIFJlbGF0ZWQgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBpZGVudGlmaWVyIC0gVGVuYW50IGRhdGFiYXNlIGlkZW50aWZpZXIuXG4gICAqIEBwYXJhbSB7VGVuYW50RGF0YWJhc2VQcm92aWRlclR5cGV9IHByb3ZpZGVyIC0gVGVuYW50IGRhdGFiYXNlIHByb3ZpZGVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXI+fSAtIERlcGVuZGVudCByb3cgY291bnQuXG4gICAqL1xuICBhc3luYyBfZGVwZW5kZW50UmVzdHJpY3RQcm92aWRlckNvdW50KGluc3RhbmNlUmVsYXRpb25zaGlwLCBUYXJnZXRNb2RlbENsYXNzLCBpZGVudGlmaWVyLCBwcm92aWRlcikge1xuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5fZ2V0Q29uZmlndXJhdGlvbigpXG4gICAgY29uc3QgdGVuYW50cyA9IGF3YWl0IHRoaXMuX2RlcGVuZGVudFJlc3RyaWN0UHJvdmlkZXJUZW5hbnRzKGluc3RhbmNlUmVsYXRpb25zaGlwLCBUYXJnZXRNb2RlbENsYXNzLCBpZGVudGlmaWVyLCBwcm92aWRlcilcblxuICAgIGZvciAoY29uc3QgdGVuYW50IG9mIHRlbmFudHMpIHtcbiAgICAgIGNvbnN0IGNvdW50ID0gYXdhaXQgY29uZmlndXJhdGlvbi5ydW5XaXRoVGVuYW50KHRlbmFudCwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBpZiAoIWNvbmZpZ3VyYXRpb24uaXNEYXRhYmFzZUlkZW50aWZpZXJBY3RpdmUoaWRlbnRpZmllcikpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFRlbmFudCBkYXRhYmFzZSBpZGVudGlmaWVyICR7aWRlbnRpZmllcn0gaXMgaW5hY3RpdmUgd2hpbGUgY2hlY2tpbmcgZGVwZW5kZW50ICR7aW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0UmVsYXRpb25zaGlwKCkuZ2V0UmVsYXRpb25zaGlwTmFtZSgpfWApXG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gYXdhaXQgY29uZmlndXJhdGlvbi5lbnN1cmVDb25uZWN0aW9ucyh7ZGF0YWJhc2VJZGVudGlmaWVyczogW2lkZW50aWZpZXJdLCBuYW1lOiBgRGVwZW5kZW50IHJlc3RyaWN0IGNvdW50OiAke1RhcmdldE1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCl9YH0sIGFzeW5jICgpID0+IHtcbiAgICAgICAgICByZXR1cm4gYXdhaXQgaW5zdGFuY2VSZWxhdGlvbnNoaXAucXVlcnkoKS5jb3VudCgpXG4gICAgICAgIH0pXG4gICAgICB9KVxuXG4gICAgICBpZiAoY291bnQgPiAwKSByZXR1cm4gY291bnRcbiAgICB9XG5cbiAgICByZXR1cm4gMFxuICB9XG5cbiAgLyoqXG4gICAqIExpc3RzIHJlc3RyaWN0LWNoZWNrIHRlbmFudHMgZm9yIG9uZSBjb25maWd1cmVkIHRlbmFudCBwcm92aWRlci5cbiAgICogQHBhcmFtIHtSZXN0cmljdEluc3RhbmNlUmVsYXRpb25zaGlwfSBpbnN0YW5jZVJlbGF0aW9uc2hpcCAtIFJlbGF0aW9uc2hpcCBpbnN0YW5jZSB0byBjb3VudC5cbiAgICogQHBhcmFtIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IFRhcmdldE1vZGVsQ2xhc3MgLSBSZWxhdGVkIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gaWRlbnRpZmllciAtIFRlbmFudCBkYXRhYmFzZSBpZGVudGlmaWVyLlxuICAgKiBAcGFyYW0ge1RlbmFudERhdGFiYXNlUHJvdmlkZXJUeXBlfSBwcm92aWRlciAtIFRlbmFudCBkYXRhYmFzZSBwcm92aWRlci5cbiAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+Pn0gLSBMaXN0ZWQgdGVuYW50IG9iamVjdHMuXG4gICAqL1xuICBhc3luYyBfZGVwZW5kZW50UmVzdHJpY3RQcm92aWRlclRlbmFudHMoaW5zdGFuY2VSZWxhdGlvbnNoaXAsIFRhcmdldE1vZGVsQ2xhc3MsIGlkZW50aWZpZXIsIHByb3ZpZGVyKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLl9nZXRDb25maWd1cmF0aW9uKClcbiAgICBjb25zdCBsaXN0VGVuYW50cyA9IHR5cGVvZiBwcm92aWRlci5saXN0UmVzdHJpY3RUZW5hbnRzID09IFwiZnVuY3Rpb25cIlxuICAgICAgPyBwcm92aWRlci5saXN0UmVzdHJpY3RUZW5hbnRzXG4gICAgICA6IHByb3ZpZGVyLmxpc3RUZW5hbnRzXG4gICAgY29uc3QgbGlzdFRlbmFudHNNZXRob2ROYW1lID0gdHlwZW9mIHByb3ZpZGVyLmxpc3RSZXN0cmljdFRlbmFudHMgPT0gXCJmdW5jdGlvblwiXG4gICAgICA/IFwibGlzdFJlc3RyaWN0VGVuYW50c1wiXG4gICAgICA6IFwibGlzdFRlbmFudHNcIlxuXG4gICAgaWYgKHR5cGVvZiBsaXN0VGVuYW50cyAhPSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVGVuYW50IGRhdGFiYXNlIHByb3ZpZGVyIGZvciAke2lkZW50aWZpZXJ9IG11c3QgZGVmaW5lIGxpc3RUZW5hbnRzIG9yIGxpc3RSZXN0cmljdFRlbmFudHMgYmVmb3JlIGRlcGVuZGVudCByZXN0cmljdCBjYW4gY2hlY2sgJHtpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRSZWxhdGlvbnNoaXAoKS5nZXRSZWxhdGlvbnNoaXBOYW1lKCl9YClcbiAgICB9XG5cbiAgICBjb25zdCB0ZW5hbnRzID0gYXdhaXQgY29uZmlndXJhdGlvbi5lbnN1cmVDb25uZWN0aW9ucyh7bmFtZTogYERlcGVuZGVudCByZXN0cmljdCB0ZW5hbnRzOiAke1RhcmdldE1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCl9YH0sIGFzeW5jICgpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCBsaXN0VGVuYW50cyh7XG4gICAgICAgIGNvbmZpZ3VyYXRpb24sXG4gICAgICAgIGlkZW50aWZpZXJcbiAgICAgIH0pXG4gICAgfSlcblxuICAgIGlmICghQXJyYXkuaXNBcnJheSh0ZW5hbnRzKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBUZW5hbnQgZGF0YWJhc2UgcHJvdmlkZXIgZm9yICR7aWRlbnRpZmllcn0gbXVzdCByZXR1cm4gYW4gYXJyYXkgZnJvbSAke2xpc3RUZW5hbnRzTWV0aG9kTmFtZX1gKVxuICAgIH1cblxuICAgIHJldHVybiB0ZW5hbnRzXG4gIH1cblxuICAvKipcbiAgICogRGVzdHJveXMgdGhlIHJlY29yZCBpbiB0aGUgZGF0YWJhc2UgYW5kIGFsbCBvZiBpdHMgZGVwZW5kZW50IHJlY29yZHMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBkZXN0cm95KCkge1xuICAgIGF3YWl0IHRoaXMuX3J1bkxpZmVjeWNsZUNhbGxiYWNrcyhcImJlZm9yZURlc3Ryb3lcIilcblxuICAgIGZvciAoY29uc3QgcmVsYXRpb25zaGlwIG9mIHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldFJlbGF0aW9uc2hpcHMoKSkge1xuICAgICAgaWYgKHJlbGF0aW9uc2hpcC5nZXREZXBlbmRlbnQoKSA9PSBcInJlc3RyaWN0XCIpIHtcbiAgICAgICAgY29uc3QgaW5zdGFuY2VSZWxhdGlvbnNoaXAgPSAvKiogQHR5cGUge1Jlc3RyaWN0SW5zdGFuY2VSZWxhdGlvbnNoaXB9ICovICh0aGlzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXAuZ2V0UmVsYXRpb25zaGlwTmFtZSgpKSlcbiAgICAgICAgY29uc3QgY291bnQgPSBhd2FpdCB0aGlzLl9kZXBlbmRlbnRSZXN0cmljdENvdW50KGluc3RhbmNlUmVsYXRpb25zaGlwKVxuXG4gICAgICAgIGlmIChjb3VudCA+IDApIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENhbm5vdCBkZWxldGUgcmVjb3JkIGJlY2F1c2UgZGVwZW5kZW50ICR7cmVsYXRpb25zaGlwLmdldFJlbGF0aW9uc2hpcE5hbWUoKX0gZXhpc3RgKVxuICAgICAgICB9XG5cbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgaWYgKHJlbGF0aW9uc2hpcC5nZXREZXBlbmRlbnQoKSAhPSBcImRlc3Ryb3lcIikge1xuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCBpbnN0YW5jZVJlbGF0aW9uc2hpcCA9IHRoaXMuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcC5nZXRSZWxhdGlvbnNoaXBOYW1lKCkpXG5cbiAgICAgIC8qKlxuICAgICAgICogRGVmaW5lcyBtb2RlbHMuXG4gICAgICAgKiBAdHlwZSB7VmVsb2Npb3VzRGF0YWJhc2VSZWNvcmRbXX0gKi9cbiAgICAgIGxldCBtb2RlbHNcblxuICAgICAgaWYgKGluc3RhbmNlUmVsYXRpb25zaGlwLmdldFR5cGUoKSA9PSBcImJlbG9uZ3NUb1wiKSB7XG4gICAgICAgIGlmICghaW5zdGFuY2VSZWxhdGlvbnNoaXAuaXNMb2FkZWQoKSkge1xuICAgICAgICAgIGF3YWl0IGluc3RhbmNlUmVsYXRpb25zaGlwLmxvYWQoKVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgbW9kZWwgPSBpbnN0YW5jZVJlbGF0aW9uc2hpcC5sb2FkZWQoKVxuXG4gICAgICAgIGlmIChtb2RlbCBpbnN0YW5jZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkKSB7XG4gICAgICAgICAgbW9kZWxzID0gW21vZGVsXVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5leHBlY3RlZCBsb2FkZWQgdHlwZTogJHt0eXBlb2YgbW9kZWx9YClcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmIChpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRUeXBlKCkgPT0gXCJoYXNNYW55XCIpIHtcbiAgICAgICAgaWYgKCFpbnN0YW5jZVJlbGF0aW9uc2hpcC5pc0xvYWRlZCgpKSB7XG4gICAgICAgICAgYXdhaXQgaW5zdGFuY2VSZWxhdGlvbnNoaXAubG9hZCgpXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBsb2FkZWRNb2RlbHMgPSBpbnN0YW5jZVJlbGF0aW9uc2hpcC5sb2FkZWQoKVxuXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGxvYWRlZE1vZGVscykpIHtcbiAgICAgICAgICBtb2RlbHMgPSBsb2FkZWRNb2RlbHNcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuZXhwZWN0ZWQgbG9hZGVkIHR5cGU6ICR7dHlwZW9mIGxvYWRlZE1vZGVsc31gKVxuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKGluc3RhbmNlUmVsYXRpb25zaGlwLmdldFR5cGUoKSA9PSBcImhhc09uZVwiKSB7XG4gICAgICAgIGlmICghaW5zdGFuY2VSZWxhdGlvbnNoaXAuaXNMb2FkZWQoKSkge1xuICAgICAgICAgIGF3YWl0IGluc3RhbmNlUmVsYXRpb25zaGlwLmxvYWQoKVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgbG9hZGVkTW9kZWwgPSBpbnN0YW5jZVJlbGF0aW9uc2hpcC5sb2FkZWQoKVxuXG4gICAgICAgIGlmIChsb2FkZWRNb2RlbCBpbnN0YW5jZW9mIFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkKSB7XG4gICAgICAgICAgbW9kZWxzID0gW2xvYWRlZE1vZGVsXVxuICAgICAgICB9IGVsc2UgaWYgKGxvYWRlZE1vZGVsID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBtb2RlbHMgPSBbXVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5leHBlY3RlZCBsb2FkZWQgdHlwZTogJHt0eXBlb2YgbG9hZGVkTW9kZWx9YClcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmhhbmRsZWQgcmVsYXRpb25zaGlwIHR5cGU6ICR7aW5zdGFuY2VSZWxhdGlvbnNoaXAuZ2V0VHlwZSgpfWApXG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3QgbW9kZWwgb2YgbW9kZWxzKSB7XG4gICAgICAgIGlmIChtb2RlbC5pc1BlcnNpc3RlZCgpKSB7XG4gICAgICAgICAgYXdhaXQgbW9kZWwuZGVzdHJveSgpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBDb25kaXRpb25zLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgY29uZGl0aW9ucyA9IHt9XG5cbiAgICBjb25kaXRpb25zW3RoaXMuZ2V0TW9kZWxDbGFzcygpLnByaW1hcnlLZXkoKV0gPSB0aGlzLmlkKClcblxuICAgIGNvbnN0IHNxbCA9IHRoaXMuX2Nvbm5lY3Rpb24oKS5kZWxldGVTcWwoe1xuICAgICAgY29uZGl0aW9ucyxcbiAgICAgIHRhYmxlTmFtZTogdGhpcy5fdGFibGVOYW1lKClcbiAgICB9KVxuXG4gICAgYXdhaXQgdGhpcy5fY29ubmVjdGlvbigpLnF1ZXJ5KHNxbCwge2xvZ05hbWU6IGAke3RoaXMuZ2V0TW9kZWxDbGFzcygpLm5hbWV9IERlc3Ryb3lgfSlcbiAgICBhd2FpdCB0aGlzLl9ydW5MaWZlY3ljbGVDYWxsYmFja3MoXCJhZnRlckRlc3Ryb3lcIilcbiAgICBhd2FpdCB0aGlzLl9lbWl0UmVjb3JkQ2hhbmdlQWZ0ZXJDb21taXQoXCJkZXN0cm95XCIpXG4gIH1cblxuICAvKipcbiAgICogRW1pdHMgYSBjb21taXR0ZWQgcmVjb3JkLWNoYW5nZSBldmVudCBhZnRlciB0aGUgc3Vycm91bmRpbmcgdHJhbnNhY3Rpb25cbiAgICogY29tbWl0cywgc28gbGl2ZSBxdWVyaWVzIHJlLXJ1biB1bmlmb3JtbHkgZm9yIGxvY2FsIHdyaXRlcywgcHVsbCBhcHBsaWVzLCBhbmRcbiAgICogcmVhbHRpbWUgYXBwbGllcyAod2hpY2ggYWxsIGVuZCBhcyBsb2NhbCBzYXZlcy9kZXN0cm95cykuIFJlZ2lzdGVyZWQgdGhyb3VnaFxuICAgKiB0aGUgY29ubmVjdGlvbidzIGFmdGVyQ29tbWl0IGhvb2sgc28gYSByb2xsZWQtYmFjayBzYXZlIGVtaXRzIG5vdGhpbmcsIGFuZFxuICAgKiBza2lwcGVkIGVudGlyZWx5IHdoZW4gbm90aGluZyBvYnNlcnZlcyB0aGlzIG1vZGVsIGNsYXNzIHNvIHNlcnZlci1zaWRlIHNhdmVzXG4gICAqIHN0YXkgZnJlZSBvZiBsaXZlLXF1ZXJ5IG92ZXJoZWFkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL3JlY29yZC1jaGFuZ2VzLmpzXCIpLlJlY29yZENoYW5nZU9wZXJhdGlvbn0gb3BlcmF0aW9uIC0gVGhlIGNvbW1pdHRlZCBvcGVyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgX2VtaXRSZWNvcmRDaGFuZ2VBZnRlckNvbW1pdChvcGVyYXRpb24pIHtcbiAgICBjb25zdCBtb2RlbENsYXNzID0gdGhpcy5nZXRNb2RlbENsYXNzKClcblxuICAgIGlmICghcmVjb3JkQ2hhbmdlcy5oYXNMaXN0ZW5lcnMobW9kZWxDbGFzcykpIHJldHVyblxuXG4gICAgY29uc3QgcmVjb3JkID0gdGhpc1xuICAgIGNvbnN0IGRhdGFiYXNlSWRlbnRpdHkgPSB0aGlzLl9kYXRhYmFzZU9wZXJhdGlvblxuICAgICAgPyB0aGlzLl9kYXRhYmFzZU9wZXJhdGlvbi5kYXRhYmFzZUlkZW50aXR5KClcbiAgICAgIDogdGhpcy5fZGF0YWJhc2VJZGVudGl0eUZvckNvbm5lY3Rpb24odGhpcy5fY29ubmVjdGlvbigpKVxuXG4gICAgdGhpcy5jYXB0dXJlRGF0YWJhc2VJZGVudGl0eShkYXRhYmFzZUlkZW50aXR5KVxuXG4gICAgYXdhaXQgdGhpcy5fY29ubmVjdGlvbigpLmFmdGVyQ29tbWl0KCgpID0+IHtcbiAgICAgIHJlY29yZENoYW5nZXMuZW1pdCh7ZGF0YWJhc2VJZGVudGl0eSwgbW9kZWxDbGFzcywgb3BlcmF0aW9uLCByZWNvcmR9KVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogU3RvcmVzIGFuIGF1ZGl0IHJvdyBmb3IgdGhpcyByZWNvcmQuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9hdWRpdGluZy5qc1wiKS5DcmVhdGVBdWRpdEFyZ3N9IGFyZ3MgLSBBdWRpdCByb3cgb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyIHwgc3RyaW5nPn0gQ3JlYXRlZCBhdWRpdCByb3cgaWQuXG4gICAqL1xuICBhc3luYyBjcmVhdGVBdWRpdChhcmdzKSB7XG4gICAgcmV0dXJuIGF3YWl0IGNyZWF0ZUF1ZGl0KHRoaXMsIGFyZ3MpXG4gIH1cblxuICAvKipcbiAgICogQ2FwdHVyZXMgY3JlYXRlIGNoYW5nZXMgYmVmb3JlIHBlcnNpc3RlbmNlIGNsZWFycyB0aGUgY2hhbmdlIHNldC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICBjYXB0dXJlQ3JlYXRlQXVkaXRDaGFuZ2VzKCkge1xuICAgIGNhcHR1cmVDcmVhdGVBdWRpdENoYW5nZXModGhpcylcbiAgfVxuXG4gIC8qKlxuICAgKiBXcml0ZXMgdGhlIGNyZWF0ZSBhdWRpdCByb3cuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgY3JlYXRlQ3JlYXRlQXVkaXQoKSB7XG4gICAgYXdhaXQgY3JlYXRlQ3JlYXRlQXVkaXQodGhpcylcbiAgfVxuXG4gIC8qKlxuICAgKiBDYXB0dXJlcyB1cGRhdGUgY2hhbmdlcyBiZWZvcmUgcGVyc2lzdGVuY2UgY2xlYXJzIHRoZSBjaGFuZ2Ugc2V0LlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIGNhcHR1cmVVcGRhdGVBdWRpdENoYW5nZXMoKSB7XG4gICAgY2FwdHVyZVVwZGF0ZUF1ZGl0Q2hhbmdlcyh0aGlzKVxuICB9XG5cbiAgLyoqXG4gICAqIFdyaXRlcyB0aGUgdXBkYXRlIGF1ZGl0IHJvdy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBjcmVhdGVVcGRhdGVBdWRpdCgpIHtcbiAgICBhd2FpdCBjcmVhdGVVcGRhdGVBdWRpdCh0aGlzKVxuICB9XG5cbiAgLyoqXG4gICAqIFdyaXRlcyB0aGUgZGVzdHJveSBhdWRpdCByb3cuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICAgKi9cbiAgYXN5bmMgY3JlYXRlRGVzdHJveUF1ZGl0KCkge1xuICAgIGF3YWl0IGNyZWF0ZURlc3Ryb3lBdWRpdCh0aGlzKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcnVuIGxpZmVjeWNsZSBjYWxsYmFja3MuXG4gICAqIEBwYXJhbSB7XCJhZnRlckNyZWF0ZVwiIHwgXCJhZnRlckRlc3Ryb3lcIiB8IFwiYWZ0ZXJTYXZlXCIgfCBcImFmdGVyVXBkYXRlXCIgfCBcImJlZm9yZUNyZWF0ZVwiIHwgXCJiZWZvcmVEZXN0cm95XCIgfCBcImJlZm9yZVNhdmVcIiB8IFwiYmVmb3JlVXBkYXRlXCIgfCBcImJlZm9yZVZhbGlkYXRpb25cIn0gY2FsbGJhY2tOYW1lIC0gQ2FsbGJhY2sgdHlwZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gICAqL1xuICBhc3luYyBfcnVuTGlmZWN5Y2xlQ2FsbGJhY2tzKGNhbGxiYWNrTmFtZSkge1xuICAgIGNvbnN0IGNhbGxiYWNrcyA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldExpZmVjeWNsZUNhbGxiYWNrc01hcCgpW2NhbGxiYWNrTmFtZV0gfHwgW11cbiAgICBsZXQgY2FsbGJhY2tOYW1lUmVnaXN0ZXJlZEFzU3RyaW5nID0gZmFsc2VcblxuICAgIGZvciAoY29uc3QgY2FsbGJhY2sgb2YgY2FsbGJhY2tzKSB7XG4gICAgICBpZiAodHlwZW9mIGNhbGxiYWNrID09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgaWYgKGNhbGxiYWNrID09IGNhbGxiYWNrTmFtZSkge1xuICAgICAgICAgIGNhbGxiYWNrTmFtZVJlZ2lzdGVyZWRBc1N0cmluZyA9IHRydWVcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBkeW5hbWljVGhpcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKVxuICAgICAgICBjb25zdCBtZXRob2RDYWxsYmFjayA9IGR5bmFtaWNUaGlzW2NhbGxiYWNrXVxuXG4gICAgICAgIGlmICh0eXBlb2YgbWV0aG9kQ2FsbGJhY2sgIT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBMaWZlY3ljbGUgY2FsbGJhY2sgXCIke2NhbGxiYWNrfVwiIGlzIG5vdCBhIGZ1bmN0aW9uIG9uICR7dGhpcy5nZXRNb2RlbENsYXNzKCkubmFtZX1gKVxuICAgICAgICB9XG5cbiAgICAgICAgYXdhaXQgbWV0aG9kQ2FsbGJhY2suY2FsbCh0aGlzKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYXdhaXQgY2FsbGJhY2sodGhpcylcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBkeW5hbWljVGhpcyA9IC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKVxuICAgIGNvbnN0IGluc3RhbmNlQ2FsbGJhY2sgPSBkeW5hbWljVGhpc1tjYWxsYmFja05hbWVdXG5cbiAgICBpZiAoIWNhbGxiYWNrTmFtZVJlZ2lzdGVyZWRBc1N0cmluZyAmJiB0eXBlb2YgaW5zdGFuY2VDYWxsYmFjayA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICBhd2FpdCBpbnN0YW5jZUNhbGxiYWNrLmNhbGwodGhpcylcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBoYXMgY2hhbmdlcy5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBjaGFuZ2VzLlxuICAgKi9cbiAgX2hhc0NoYW5nZXMoKSB7IHJldHVybiBPYmplY3Qua2V5cyh0aGlzLl9jaGFuZ2VzKS5sZW5ndGggPiAwIH1cblxuICAvKipcbiAgICogUmV0dXJucyB0cnVlIGlmIHRoZSBtb2RlbCBoYXMgYmVlbiBjaGFuZ2VkIHNpbmNlIGl0IHdhcyBsb2FkZWQgZnJvbSB0aGUgZGF0YWJhc2UuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgY2hhbmdlZC5cbiAgICovXG4gIGlzQ2hhbmdlZCgpIHtcbiAgICBpZiAodGhpcy5pc05ld1JlY29yZCgpIHx8IHRoaXMuX2hhc0NoYW5nZXMoKSl7XG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH1cblxuICAgIC8vIENoZWNrIGlmIGEgbG9hZGVkIHN1Yi1tb2RlbCBvZiBhIHJlbGF0aW9uc2hpcCBpcyBjaGFuZ2VkIGFuZCBzaG91bGQgYmUgc2F2ZWQgYWxvbmcgd2l0aCB0aGlzIG1vZGVsLlxuICAgIGlmICh0aGlzLl9pbnN0YW5jZVJlbGF0aW9uc2hpcHMpIHtcbiAgICAgIGZvciAoY29uc3QgaW5zdGFuY2VSZWxhdGlvbnNoaXBOYW1lIGluIHRoaXMuX2luc3RhbmNlUmVsYXRpb25zaGlwcykge1xuICAgICAgICBjb25zdCBpbnN0YW5jZVJlbGF0aW9uc2hpcCA9IHRoaXMuX2luc3RhbmNlUmVsYXRpb25zaGlwc1tpbnN0YW5jZVJlbGF0aW9uc2hpcE5hbWVdXG4gICAgICAgIGxldCBsb2FkZWQgPSBpbnN0YW5jZVJlbGF0aW9uc2hpcC5fbG9hZGVkXG5cbiAgICAgICAgaWYgKGluc3RhbmNlUmVsYXRpb25zaGlwLmdldEF1dG9TYXZlKCkgPT09IGZhbHNlKSB7XG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghbG9hZGVkKSBjb250aW51ZVxuICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkobG9hZGVkKSkgbG9hZGVkID0gW2xvYWRlZF1cblxuICAgICAgICBmb3IgKGNvbnN0IG1vZGVsIG9mIGxvYWRlZCkge1xuICAgICAgICAgIGlmIChtb2RlbC5pc0NoYW5nZWQoKSkge1xuICAgICAgICAgICAgcmV0dXJuIHRydWVcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRoZSBjaGFuZ2VzIHRoYXQgaGF2ZSBiZWVuIG1hZGUgdG8gdGhpcyByZWNvcmQgc2luY2UgaXQgd2FzIGxvYWRlZCBmcm9tIHRoZSBkYXRhYmFzZS5cbiAgICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59IC0gVGhlIGNoYW5nZXMuXG4gICAqL1xuICBjaGFuZ2VzKCkge1xuICAgIC8qKlxuICAgICAqIENoYW5nZXMuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIEFycmF5PFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pj59ICovXG4gICAgY29uc3QgY2hhbmdlcyA9IHt9XG5cbiAgICBmb3IgKGNvbnN0IGNoYW5nZUtleSBpbiB0aGlzLl9jaGFuZ2VzKSB7XG4gICAgICBjb25zdCBjaGFuZ2VWYWx1ZSA9IHRoaXMuX2NoYW5nZXNbY2hhbmdlS2V5XVxuXG4gICAgICBjaGFuZ2VzW2NoYW5nZUtleV0gPSBbdGhpcy5fYXR0cmlidXRlc1tjaGFuZ2VLZXldLCBjaGFuZ2VWYWx1ZV1cbiAgICB9XG5cbiAgICByZXR1cm4gY2hhbmdlc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdGFibGUgbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgdGFibGUgbmFtZS5cbiAgICovXG4gIF90YWJsZU5hbWUoKSB7XG4gICAgaWYgKHRoaXMuX190YWJsZU5hbWUpIHJldHVybiB0aGlzLl9fdGFibGVOYW1lXG5cbiAgICByZXR1cm4gdGhpcy5nZXRNb2RlbENsYXNzKCkudGFibGVOYW1lKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyBhbiBhdHRyaWJ1dGUgdmFsdWUgZnJvbSB0aGUgcmVjb3JkLiBSZWFkIGR5bmFtaWNhbGx5IGJ5IG5hbWUsIHNvIHRoZSB2YWx1ZSBjYW4gYmUgYW55XG4gICAqIGNvbHVtbiB0eXBlIGFuZCBtYXkgYmUgb3ZlcnJpZGRlbiBieSBhIHVzZXItZGVmaW5lZCBnZXR0ZXIgb24gdGhlIG1vZGVsLlxuICAgKiBAdGVtcGxhdGUgVlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXR0cmlidXRlTmFtZSBUaGUgbmFtZSBvZiB0aGUgYXR0cmlidXRlIHRvIHJlYWQuIFRoaXMgaXMgdGhlIGF0dHJpYnV0ZSBuYW1lLCBub3QgdGhlIGNvbHVtbiBuYW1lLlxuICAgKiBAcmV0dXJucyB7Vn0gVGhlIGF0dHJpYnV0ZSB2YWx1ZSwgdHlwZWQgYnkgdGhlIGNhbGxlcidzIGFjY2Vzc29yIGNvbnRyYWN0LlxuICAgKi9cbiAgcmVhZEF0dHJpYnV0ZShhdHRyaWJ1dGVOYW1lKSB7XG4gICAgdGhpcy5nZXRNb2RlbENsYXNzKCkuX2Fzc2VydEhhc0JlZW5Jbml0aWFsaXplZCgpXG4gICAgY29uc3QgbWFwID0gdGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0QXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCgpXG4gICAgY29uc3QgcmVzb2x2ZWRBdHRyaWJ1dGVOYW1lID0gdGhpcy5nZXRNb2RlbENsYXNzKCkucmVzb2x2ZUF0dHJpYnV0ZU5hbWUoYXR0cmlidXRlTmFtZSlcbiAgICBjb25zdCBjb2x1bW5OYW1lID0gcmVzb2x2ZWRBdHRyaWJ1dGVOYW1lID8gbWFwW3Jlc29sdmVkQXR0cmlidXRlTmFtZV0gOiB1bmRlZmluZWRcblxuICAgIGlmICghY29sdW1uTmFtZSkgdGhyb3cgbmV3IEVycm9yKGBDb3VsZG4ndCBmaWd1cmUgb3V0IGNvbHVtbiBuYW1lIGZvciBhdHRyaWJ1dGU6ICR7YXR0cmlidXRlTmFtZX0gZnJvbSB0aGVzZSBtYXBwaW5nczogJHtPYmplY3Qua2V5cyhtYXApLmpvaW4oXCIsIFwiKX1gKVxuXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7Vn0gKi8gKHRoaXMucmVhZENvbHVtbihjb2x1bW5OYW1lKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkIGFuIGFzc29jaWF0aW9uIGNvdW50IGF0dGFjaGVkIGJ5IGAud2l0aENvdW50KC4uLilgLiBDb3VudHMgYXJlXG4gICAqIHN0b3JlZCBvbiBhIHNlcGFyYXRlIG1hcCBmcm9tIHRoZSByZWNvcmQncyBgX2F0dHJpYnV0ZXNgIHNvIGFcbiAgICogdmlydHVhbCBjb3VudCBsaWtlIGB0YXNrc0NvdW50YCBjYW5ub3Qgc2lsZW50bHkgc2hhZG93IGEgcmVhbFxuICAgKiBjb2x1bW4gb2YgdGhlIHNhbWUgbmFtZS4gUmV0dXJucyB0aGUgYXR0YWNoZWQgbnVtYmVyLCBvciAwIHdoZW5cbiAgICogYC53aXRoQ291bnQoLi4uKWAgd2Fzbid0IHJlcXVlc3RlZCBmb3IgdGhpcyBhdHRyaWJ1dGUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIC0gQXR0cmlidXRlIG5hbWUsIGUuZy4gYFwidGFza3NDb3VudFwiYCBvciBhIGN1c3RvbSBgXCJhY3RpdmVNZW1iZXJzQ291bnRcImAgZnJvbSBgLndpdGhDb3VudCh7YWN0aXZlTWVtYmVyc0NvdW50OiB7Li4ufX0pYC5cbiAgICogQHJldHVybnMge251bWJlcn0gLSBBdHRhY2hlZCBhc3NvY2lhdGlvbiBjb3VudCwgb3IgemVybyB3aGVuIGFic2VudC5cbiAgICovXG4gIHJlYWRDb3VudChhdHRyaWJ1dGVOYW1lKSB7XG4gICAgcmV0dXJuIHJlYWRQYXlsb2FkQXNzb2NpYXRpb25Db3VudCgvKiogQHR5cGUge2ltcG9ydChcIi4uLy4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiKS5SZWNvcmRQYXlsb2FkVmFsdWVzVGFyZ2V0fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKSwgYXR0cmlidXRlTmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBdHRhY2ggYW4gYXNzb2NpYXRpb24gY291bnQgdG8gdGhpcyByZWNvcmQuIEludGVybmFsIGhlbHBlciB1c2VkIGJ5XG4gICAqIHRoZSBgd2l0aENvdW50YCBydW5uZXI7IG91dHNpZGUgY29kZSBzaG91bGQgbm90IGNhbGwgdGhpcyBkaXJlY3RseS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGF0dHJpYnV0ZU5hbWUgLSBBdHRyaWJ1dGUgbmFtZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IHZhbHVlIC0gQ291bnQgdmFsdWUuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3NldEFzc29jaWF0aW9uQ291bnQoYXR0cmlidXRlTmFtZSwgdmFsdWUpIHtcbiAgICBzZXRQYXlsb2FkQXNzb2NpYXRpb25Db3VudCgvKiogQHR5cGUge2ltcG9ydChcIi4uLy4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiKS5SZWNvcmRQYXlsb2FkVmFsdWVzVGFyZ2V0fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKSwgYXR0cmlidXRlTmFtZSwgdmFsdWUpXG4gIH1cblxuICAvKipcbiAgICogQWxsIGF0dGFjaGVkIGFzc29jaWF0aW9uIGNvdW50cyBhcyBhIHBsYWluIG9iamVjdC4gVXNlZCBieSB0aGVcbiAgICogZnJvbnRlbmQtbW9kZWwgc2VyaWFsaXplciB0byBzaGlwIGNvdW50cyBhbG9uZ3NpZGUgdGhlIHJlY29yZFxuICAgKiBhdHRyaWJ1dGVzIG9uIHRoZSB3aXJlLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgbnVtYmVyPn0gLSBBc3NvY2lhdGlvbiBjb3VudHMga2V5ZWQgYnkgYXR0cmlidXRlIG5hbWUuXG4gICAqL1xuICBhc3NvY2lhdGlvbkNvdW50cygpIHtcbiAgICAvKipcbiAgICAgKiBSZXN1bHQuXG4gICAgICogQHR5cGUge1JlY29yZDxzdHJpbmcsIG51bWJlcj59ICovXG4gICAgY29uc3QgcmVzdWx0ID0ge31cblxuICAgIGNvbnN0IHRhcmdldCA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vLi4vcmVjb3JkLXBheWxvYWQtdmFsdWVzLmpzXCIpLlJlY29yZFBheWxvYWRWYWx1ZXNUYXJnZXR9ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpXG5cbiAgICBpZiAoIXRhcmdldC5fYXNzb2NpYXRpb25Db3VudHMpIHJldHVybiByZXN1bHRcblxuICAgIGZvciAoY29uc3QgW2F0dHJpYnV0ZU5hbWUsIHZhbHVlXSBvZiB0YXJnZXQuX2Fzc29jaWF0aW9uQ291bnRzKSB7XG4gICAgICByZXN1bHRbYXR0cmlidXRlTmFtZV0gPSB2YWx1ZVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkIGEgdmFsdWUgYXR0YWNoZWQgYnkgYC5xdWVyeURhdGEoLi4uKWAuIFN0b3JlZCBvbiBhIGRlZGljYXRlZFxuICAgKiBtYXAgcmF0aGVyIHRoYW4gb24gYF9hdHRyaWJ1dGVzYCwgc28gYSB2aXJ0dWFsIHF1ZXJ5RGF0YSBrZXkgbGlrZVxuICAgKiBgdHJhbnNwb3J0U2Vjb25kc1N1bWAgY2Fubm90IHNpbGVudGx5IHNoYWRvdyBhIHJlYWwgY29sdW1uIG9mIHRoZVxuICAgKiBzYW1lIG5hbWUuIFJldHVybnMgYG51bGxgIHdoZW4gdGhlIGtleSB3YXNuJ3QgcHJvZHVjZWQgYnkgYW55XG4gICAqIHJlZ2lzdGVyZWQgZm4gZm9yIHRoaXMgcmVjb3JkIChlLmcuIG5vIGNoaWxkIHJvd3MgbWF0Y2hlZCB0aGVcbiAgICogYWdncmVnYXRlKS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBxdWVyeURhdGEgYXR0cmlidXRlIG5hbWUgKG1hdGNoZXMgYSBTRUxFQ1QgYWxpYXMgZnJvbSB0aGUgcmVnaXN0ZXJlZCBmbikuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBBdHRhY2hlZCBxdWVyeS1kYXRhIHZhbHVlLlxuICAgKi9cbiAgcXVlcnlEYXRhKG5hbWUpIHtcbiAgICByZXR1cm4gcmVhZFBheWxvYWRRdWVyeURhdGEoLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9yZWNvcmQtcGF5bG9hZC12YWx1ZXMuanNcIikuUmVjb3JkUGF5bG9hZFZhbHVlc1RhcmdldH0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSksIG5hbWUpXG4gIH1cblxuICAvKipcbiAgICogQXR0YWNoIGEgcXVlcnlEYXRhIHZhbHVlIHRvIHRoaXMgcmVjb3JkLiBJbnRlcm5hbCBoZWxwZXIgdXNlZCBieVxuICAgKiB0aGUgYHF1ZXJ5RGF0YWAgcnVubmVyIGFuZCBieSBmcm9udGVuZC1tb2RlbCBoeWRyYXRpb247IG91dHNpZGVcbiAgICogY29kZSBzaG91bGQgbm90IGNhbGwgdGhpcyBkaXJlY3RseS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG5hbWUgLSBxdWVyeURhdGEgYXR0cmlidXRlIG5hbWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gVmFsdWUgdG8gYXR0YWNoLlxuICAgKiBAcmV0dXJucyB7dm9pZH1cbiAgICovXG4gIF9zZXRRdWVyeURhdGEobmFtZSwgdmFsdWUpIHtcbiAgICBzZXRQYXlsb2FkUXVlcnlEYXRhKC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vLi4vcmVjb3JkLXBheWxvYWQtdmFsdWVzLmpzXCIpLlJlY29yZFBheWxvYWRWYWx1ZXNUYXJnZXR9ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpLCBuYW1lLCB2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBbGwgYXR0YWNoZWQgcXVlcnlEYXRhIHZhbHVlcyBhcyBhIHBsYWluIG9iamVjdC4gVXNlZCBieSB0aGVcbiAgICogZnJvbnRlbmQtbW9kZWwgc2VyaWFsaXplciB0byBzaGlwIHF1ZXJ5RGF0YSBhbG9uZ3NpZGUgdGhlIHJlY29yZFxuICAgKiBhdHRyaWJ1dGVzIG9uIHRoZSB3aXJlLlxuICAgKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAtIFF1ZXJ5LWRhdGEgdmFsdWVzIGtleWVkIGJ5IG5hbWUuXG4gICAqL1xuICBxdWVyeURhdGFWYWx1ZXMoKSB7XG4gICAgLyoqXG4gICAgICogUmVzdWx0LlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgcmVzdWx0ID0ge31cblxuICAgIGNvbnN0IHRhcmdldCA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi4vLi4vcmVjb3JkLXBheWxvYWQtdmFsdWVzLmpzXCIpLlJlY29yZFBheWxvYWRWYWx1ZXNUYXJnZXR9ICovICgvKiogQHR5cGUge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAqLyAodGhpcykpXG5cbiAgICBpZiAoIXRhcmdldC5fcXVlcnlEYXRhVmFsdWVzKSByZXR1cm4gcmVzdWx0XG5cbiAgICBmb3IgKGNvbnN0IFtuYW1lLCB2YWx1ZV0gb2YgdGFyZ2V0Ll9xdWVyeURhdGFWYWx1ZXMpIHtcbiAgICAgIHJlc3VsdFtuYW1lXSA9IHZhbHVlXG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdFxuICB9XG5cbiAgLyoqXG4gICAqIFJlYWQgYSBwZXItcmVjb3JkIGFiaWxpdHkgcmVzdWx0IGF0dGFjaGVkIGJ5IGAuYWJpbGl0aWVzKC4uLilgLiBUaGVcbiAgICogYmFja2VuZCBldmFsdWF0ZXMgZWFjaCByZXF1ZXN0ZWQgYWN0aW9uIGFnYWluc3QgdGhlIGN1cnJlbnQgYWJpbGl0eVxuICAgKiBmb3IgdGhpcyByZWNvcmQgaW5zdGFuY2UgYW5kIHNoaXBzIHRoZSByZXN1bHQgYWxvbmdzaWRlIHRoZVxuICAgKiByZWNvcmQncyBhdHRyaWJ1dGVzLiBSZXR1cm5zIGBmYWxzZWAgd2hlbiB0aGUgYWN0aW9uIHdhc24ndFxuICAgKiByZXF1ZXN0ZWQgZm9yIHRoaXMgcmVjb3JkIOKAlCBzbyBVSSBjb2RlIGNhbiBzYWZlbHkgYnJhbmNoIG9uXG4gICAqIGByZWNvcmQuY2FuKFwidXBkYXRlXCIpYCB3aXRob3V0IGZpcnN0IGNoZWNraW5nIHdoZXRoZXIgdGhlIGFiaWxpdHlcbiAgICogd2FzIGxvYWRlZC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFjdGlvbiAtIEFiaWxpdHkgYWN0aW9uIG5hbWUsIGUuZy4gYFwidXBkYXRlXCJgLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIHRoZSByZXF1ZXN0ZWQgYWJpbGl0eSBpcyBhbGxvd2VkLlxuICAgKi9cbiAgY2FuKGFjdGlvbikge1xuICAgIHJldHVybiByZWFkUGF5bG9hZENvbXB1dGVkQWJpbGl0eSgvKiogQHR5cGUge2ltcG9ydChcIi4uLy4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiKS5SZWNvcmRQYXlsb2FkVmFsdWVzVGFyZ2V0fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKSwgYWN0aW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIEF0dGFjaCBhIHBlci1yZWNvcmQgYWJpbGl0eSByZXN1bHQgdG8gdGhpcyByZWNvcmQuIEludGVybmFsIGhlbHBlclxuICAgKiB1c2VkIGJ5IHRoZSBgYWJpbGl0aWVzYCBydW5uZXIgYW5kIGJ5IGZyb250ZW5kLW1vZGVsIGh5ZHJhdGlvbjtcbiAgICogb3V0c2lkZSBjb2RlIHNob3VsZCBub3QgY2FsbCB0aGlzIGRpcmVjdGx5LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYWN0aW9uIC0gQWJpbGl0eSBhY3Rpb24gbmFtZS5cbiAgICogQHBhcmFtIHtib29sZWFufSB2YWx1ZSAtIFdoZXRoZXIgdGhlIGN1cnJlbnQgYWJpbGl0eSBwZXJtaXRzIHRoZSBhY3Rpb24gb24gdGhpcyByZWNvcmQuXG4gICAqIEByZXR1cm5zIHt2b2lkfVxuICAgKi9cbiAgX3NldENvbXB1dGVkQWJpbGl0eShhY3Rpb24sIHZhbHVlKSB7XG4gICAgc2V0UGF5bG9hZENvbXB1dGVkQWJpbGl0eSgvKiogQHR5cGUge2ltcG9ydChcIi4uLy4uL3JlY29yZC1wYXlsb2FkLXZhbHVlcy5qc1wiKS5SZWNvcmRQYXlsb2FkVmFsdWVzVGFyZ2V0fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHRoaXMpKSwgYWN0aW9uLCB2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBbGwgYXR0YWNoZWQgcGVyLXJlY29yZCBhYmlsaXR5IHJlc3VsdHMgYXMgYSBwbGFpbiBvYmplY3QuIFVzZWRcbiAgICogYnkgdGhlIGZyb250ZW5kLW1vZGVsIHNlcmlhbGl6ZXIgdG8gc2hpcCByZXN1bHRzIGFsb25nc2lkZSB0aGVcbiAgICogcmVjb3JkIGF0dHJpYnV0ZXMgb24gdGhlIHdpcmUuXG4gICAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBib29sZWFuPn0gLSBBYmlsaXR5IHJlc3VsdHMga2V5ZWQgYnkgYWN0aW9uLlxuICAgKi9cbiAgY29tcHV0ZWRBYmlsaXRpZXMoKSB7XG4gICAgLyoqXG4gICAgICogUmVzdWx0LlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBib29sZWFuPn0gKi9cbiAgICBjb25zdCByZXN1bHQgPSB7fVxuXG4gICAgY29uc3QgdGFyZ2V0ID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi8uLi9yZWNvcmQtcGF5bG9hZC12YWx1ZXMuanNcIikuUmVjb3JkUGF5bG9hZFZhbHVlc1RhcmdldH0gKi8gKC8qKiBAdHlwZSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59ICovICh0aGlzKSlcblxuICAgIGlmICghdGFyZ2V0Ll9jb21wdXRlZEFiaWxpdGllcykgcmV0dXJuIHJlc3VsdFxuXG4gICAgZm9yIChjb25zdCBbYWN0aW9uLCB2YWx1ZV0gb2YgdGFyZ2V0Ll9jb21wdXRlZEFiaWxpdGllcykge1xuICAgICAgcmVzdWx0W2FjdGlvbl0gPSB2YWx1ZVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWFkcyBhIGNvbHVtbiB2YWx1ZSBmcm9tIHRoZSByZWNvcmQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhdHRyaWJ1dGVOYW1lIFRoZSBuYW1lIG9mIHRoZSBjb2x1bW4gdG8gcmVhZC4gVGhpcyBpcyB0aGUgY29sdW1uIG5hbWUsIG5vdCB0aGUgYXR0cmlidXRlIG5hbWUuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBUaGUgY29sdW1uLlxuICAgKi9cbiAgcmVhZENvbHVtbihhdHRyaWJ1dGVOYW1lKSB7XG4gICAgdGhpcy5nZXRNb2RlbENsYXNzKCkuX2Fzc2VydEhhc0JlZW5Jbml0aWFsaXplZCgpXG4gICAgY29uc3QgYmVsb25nc1RvQ2hhbmdlcyA9IHRoaXMuX2JlbG9uZ3NUb0NoYW5nZXMoKVxuICAgIGxldCByZXN1bHRcblxuICAgIGlmIChhdHRyaWJ1dGVOYW1lIGluIGJlbG9uZ3NUb0NoYW5nZXMpIHtcbiAgICAgIHJlc3VsdCA9IGJlbG9uZ3NUb0NoYW5nZXNbYXR0cmlidXRlTmFtZV1cbiAgICB9IGVsc2UgaWYgKGF0dHJpYnV0ZU5hbWUgaW4gdGhpcy5fY2hhbmdlcykge1xuICAgICAgcmVzdWx0ID0gdGhpcy5fY2hhbmdlc1thdHRyaWJ1dGVOYW1lXVxuICAgIH0gZWxzZSBpZiAoYXR0cmlidXRlTmFtZSBpbiB0aGlzLl9hdHRyaWJ1dGVzKSB7XG4gICAgICByZXN1bHQgPSB0aGlzLl9hdHRyaWJ1dGVzW2F0dHJpYnV0ZU5hbWVdXG4gICAgfSBlbHNlIGlmICh0aGlzLmlzUGVyc2lzdGVkKCkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gc3VjaCBhdHRyaWJ1dGUgb3Igbm90IHNlbGVjdGVkICR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfSMke2F0dHJpYnV0ZU5hbWV9YClcbiAgICB9XG5cbiAgICBjb25zdCBjb2x1bW5UeXBlID0gdGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0Q29sdW1uVHlwZUJ5TmFtZShhdHRyaWJ1dGVOYW1lKVxuXG4gICAgaWYgKGNvbHVtblR5cGUgJiYgdGhpcy5nZXRNb2RlbENsYXNzKCkuX2lzRGF0ZUxpa2VUeXBlKGNvbHVtblR5cGUpKSB7XG4gICAgICByZXN1bHQgPSB0aGlzLl9ub3JtYWxpemVEYXRlVmFsdWVGb3JSZWFkKHJlc3VsdClcbiAgICB9XG5cbiAgICByZXN1bHQgPSB0aGlzLl9ub3JtYWxpemVCb29sZWFuVmFsdWVGb3JSZWFkKHtjb2x1bW5OYW1lOiBhdHRyaWJ1dGVOYW1lLCBjb2x1bW5UeXBlLCB2YWx1ZTogcmVzdWx0fSlcblxuICAgIHJldHVybiByZXN1bHRcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXNvbHZlcyBhbnkgZGVjbGFyZWQgcGVyLWF0dHJpYnV0ZSBjYXN0IGZvciBhIGRhdGFiYXNlIGNvbHVtbiBuYW1lLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29sdW1uTmFtZSAtIERhdGFiYXNlIGNvbHVtbiBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIERlY2xhcmVkIGNhc3QgdHlwZSwgb3IgdW5kZWZpbmVkIHdoZW4gbm9uZSBpcyBkZWNsYXJlZC5cbiAgICovXG4gIF9kZWNsYXJlZEF0dHJpYnV0ZUNhc3RGb3JDb2x1bW4oY29sdW1uTmFtZSkge1xuICAgIGNvbnN0IGF0dHJpYnV0ZU5hbWUgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKClbY29sdW1uTmFtZV1cblxuICAgIGlmICghYXR0cmlidXRlTmFtZSkgcmV0dXJuIHVuZGVmaW5lZFxuXG4gICAgcmV0dXJuIHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldEF0dHJpYnV0ZUNhc3QoYXR0cmlidXRlTmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBDb252ZXJ0cyBhIHN0b3JlZCB2YWx1ZSB0byBhIHJlYWwgYm9vbGVhbiBmb3IgYSBkZWNsYXJlZCBgXCJib29sZWFuXCJgIGNhc3QuXG4gICAqIExlYXZlcyBudWxsL3VuZGVmaW5lZCB1bnRvdWNoZWQ7IHRyZWF0cyAxL3RydWUvXCIxXCIgYXMgdHJ1ZSBhbmQgMC9mYWxzZS9cIjBcIiBhcyBmYWxzZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBTdG9yZWQgZGF0YWJhc2UgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBDb252ZXJ0ZWQgYm9vbGVhbiwgb3IgdGhlIG9yaWdpbmFsIHZhbHVlIHdoZW4gbm90IHJlY29nbml6ZWQuXG4gICAqL1xuICBfY2FzdERlY2xhcmVkQm9vbGVhbkZvclJlYWQodmFsdWUpIHtcbiAgICBpZiAodmFsdWUgPT09IG51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHZhbHVlXG4gICAgaWYgKGRlY2xhcmVkQm9vbGVhblRydXRoeVZhbHVlcy5oYXModmFsdWUpKSByZXR1cm4gdHJ1ZVxuICAgIGlmIChkZWNsYXJlZEJvb2xlYW5GYWxzeVZhbHVlcy5oYXModmFsdWUpKSByZXR1cm4gZmFsc2VcblxuICAgIHJldHVybiB2YWx1ZVxuICB9XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgYSBjb2x1bW4gdmFsdWUgaXMgY3VycmVudGx5IGxvYWRlZCBvbiB0aGlzIHJlY29yZCAoZWl0aGVyIGFzIGFcbiAgICogcGVyc2lzdGVkIGF0dHJpYnV0ZSBvciBhIHBlbmRpbmcgY2hhbmdlKS4gVXNlZCB0byBkZWNpZGUgd2hldGhlciBhIHByZWxvYWRcbiAgICogY2FuIGJlIHNraXBwZWQgYmVjYXVzZSB0aGUgcmVxdWlyZWQgY29sdW1ucyBhcmUgYWxyZWFkeSBwcmVzZW50LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29sdW1uTmFtZSAtIFRoZSBjb2x1bW4gbmFtZSB0byBjaGVjay5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgY29sdW1uIGlzIGxvYWRlZC5cbiAgICovXG4gIGhhc0xvYWRlZENvbHVtbihjb2x1bW5OYW1lKSB7XG4gICAgcmV0dXJuIGNvbHVtbk5hbWUgaW4gdGhpcy5fY2hhbmdlcyB8fCBjb2x1bW5OYW1lIGluIHRoaXMuX2F0dHJpYnV0ZXNcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBib29sZWFuIHZhbHVlIGZvciByZWFkLiBBIGRlY2xhcmVkIGBcImJvb2xlYW5cImAgYXR0cmlidXRlIGNhc3QgY29udmVydHMgdGhlXG4gICAqIHN0b3JlZCB2YWx1ZSAoZS5nLiBhbiBNU1NRTCBgYml0YCAwLzEpIHRvIGEgcmVhbCBib29sZWFuOyBvdGhlcndpc2UgdGhlIGV4aXN0aW5nXG4gICAqIGludHJvc3BlY3RlZC10eXBlIG5vcm1hbGl6YXRpb24gYXBwbGllcyAobm8gYmVoYXZpb3VyIGNoYW5nZSBmb3Igbm9uLWRlY2xhcmVkIGNvbHVtbnMpLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jb2x1bW5OYW1lIC0gRGF0YWJhc2UgY29sdW1uIG5hbWUgYmVpbmcgcmVhZC5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCB1bmRlZmluZWR9IGFyZ3MuY29sdW1uVHlwZSAtIENvbHVtbiB0eXBlLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnZhbHVlIC0gVmFsdWUgdG8gbm9ybWFsaXplLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gTm9ybWFsaXplZCB2YWx1ZS5cbiAgICovXG4gIF9ub3JtYWxpemVCb29sZWFuVmFsdWVGb3JSZWFkKHtjb2x1bW5OYW1lLCBjb2x1bW5UeXBlLCB2YWx1ZX0pIHtcbiAgICBpZiAodGhpcy5fZGVjbGFyZWRBdHRyaWJ1dGVDYXN0Rm9yQ29sdW1uKGNvbHVtbk5hbWUpID09PSBcImJvb2xlYW5cIikge1xuICAgICAgcmV0dXJuIHRoaXMuX2Nhc3REZWNsYXJlZEJvb2xlYW5Gb3JSZWFkKHZhbHVlKVxuICAgIH1cblxuICAgIGlmICghY29sdW1uVHlwZSkgcmV0dXJuIHZhbHVlXG4gICAgaWYgKGNvbHVtblR5cGUudG9Mb3dlckNhc2UoKSAhPT0gXCJib29sZWFuXCIpIHJldHVybiB2YWx1ZVxuICAgIGlmICh2YWx1ZSA9PT0gMSkgcmV0dXJuIHRydWVcbiAgICBpZiAodmFsdWUgPT09IDApIHJldHVybiBmYWxzZVxuXG4gICAgcmV0dXJuIHZhbHVlXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgZGF0ZSB2YWx1ZSBmb3IgcmVhZC5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBWYWx1ZSBmcm9tIGRhdGFiYXNlLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gTm9ybWFsaXplZCB2YWx1ZS5cbiAgICovXG4gIF9ub3JtYWxpemVEYXRlVmFsdWVGb3JSZWFkKHZhbHVlKSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZURhdGVWYWx1ZUZvclJlYWQodmFsdWUsIHtkYXRhYmFzZVR5cGU6IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldERhdGFiYXNlVHlwZSgpfSlcbiAgfVxuXG4gIF9iZWxvbmdzVG9DaGFuZ2VzKCkge1xuICAgIC8qKlxuICAgICAqIEJlbG9uZ3MgdG8gY2hhbmdlcy5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGJlbG9uZ3NUb0NoYW5nZXMgPSB7fVxuXG4gICAgaWYgKHRoaXMuX2luc3RhbmNlUmVsYXRpb25zaGlwcykge1xuICAgICAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBOYW1lIGluIHRoaXMuX2luc3RhbmNlUmVsYXRpb25zaGlwcykge1xuICAgICAgICBjb25zdCByZWxhdGlvbnNoaXAgPSB0aGlzLl9pbnN0YW5jZVJlbGF0aW9uc2hpcHNbcmVsYXRpb25zaGlwTmFtZV1cblxuICAgICAgICBpZiAocmVsYXRpb25zaGlwLmdldFR5cGUoKSA9PSBcImJlbG9uZ3NUb1wiICYmIHJlbGF0aW9uc2hpcC5nZXREaXJ0eSgpKSB7XG4gICAgICAgICAgY29uc3QgbW9kZWwgPSByZWxhdGlvbnNoaXAuZ2V0TG9hZGVkT3JVbmRlZmluZWQoKVxuXG4gICAgICAgICAgaWYgKG1vZGVsKSB7XG4gICAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShtb2RlbCkpIHRocm93IG5ldyBFcnJvcihcIlVuZXhwZWN0ZWQgYmVsb25ncy10byBtb2RlbCBhcnJheVwiKVxuXG4gICAgICAgICAgICBiZWxvbmdzVG9DaGFuZ2VzW3JlbGF0aW9uc2hpcC5nZXRGb3JlaWduS2V5KCldID0gdGhpcy5fYmVsb25nc1RvRm9yZWlnbktleVZhbHVlKHttb2RlbCwgcmVsYXRpb25zaGlwfSlcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gYmVsb25nc1RvQ2hhbmdlc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgY3JlYXRlIG5ldyByZWNvcmQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfY3JlYXRlTmV3UmVjb3JkKCkge1xuICAgIC8vIFJlc29sdmUgdGhlIGNvbm5lY3Rpb24gb25jZSBhbmQgcGluIHRoZSB3aG9sZSBpbnNlcnQgcGF0aCB0byBpdDogYSBwb29sXG4gICAgLy8gY2FuIHJlc29sdmUgYSBkaWZmZXJlbnQgY3VycmVudCBjb25uZWN0aW9uIGFjcm9zcyB0aGUgYXdhaXRzIGJlbG93LCBhbmRcbiAgICAvLyB0aGUgaWRlbnRpdHktaW5zZXJ0IHdyYXBwZXIgaXMgb25seSBlZmZlY3RpdmUgb24gdGhlIGV4YWN0IHNlc3Npb24gdGhhdFxuICAgIC8vIHJhbiBTRVQgSURFTlRJVFlfSU5TRVJULlxuICAgIGNvbnN0IGNvbm5lY3Rpb24gPSB0aGlzLl9jb25uZWN0aW9uKClcblxuICAgIGlmICghY29ubmVjdGlvbltcImluc2VydFNxbFwiXSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBpbnNlcnRTcWwgb24gJHtjb25uZWN0aW9uLmNvbnN0cnVjdG9yLm5hbWV9YClcbiAgICB9XG5cbiAgICBjb25zdCBkYXRhID0gT2JqZWN0LmFzc2lnbih7fSwgdGhpcy5fYmVsb25nc1RvQ2hhbmdlcygpLCB0aGlzLnJhd0F0dHJpYnV0ZXMoKSlcbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gdGhpcy5nZXRNb2RlbENsYXNzKCkucHJpbWFyeUtleSgpXG4gICAgY29uc3QgcHJpbWFyeUtleUNvbHVtbiA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldENvbHVtbnMoKS5maW5kKChjb2x1bW4pID0+IGNvbHVtbi5nZXROYW1lKCkgPT0gcHJpbWFyeUtleSlcbiAgICBjb25zdCBwcmltYXJ5S2V5VHlwZSA9IHByaW1hcnlLZXlDb2x1bW4/LmdldFR5cGUoKT8udG9Mb3dlckNhc2UoKVxuICAgIGNvbnN0IGRyaXZlclN1cHBvcnRzRGVmYXVsdFVVSUQgPSB0eXBlb2YgY29ubmVjdGlvbi5zdXBwb3J0c0RlZmF1bHRQcmltYXJ5S2V5VVVJRCA9PSBcImZ1bmN0aW9uXCIgJiYgY29ubmVjdGlvbi5zdXBwb3J0c0RlZmF1bHRQcmltYXJ5S2V5VVVJRCgpXG4gICAgY29uc3QgaXNVVUlEUHJpbWFyeUtleSA9IHByaW1hcnlLZXlUeXBlPy5pbmNsdWRlcyhcInV1aWRcIilcbiAgICBjb25zdCBzaG91bGRBc3NpZ25VVUlEUHJpbWFyeUtleSA9IGlzVVVJRFByaW1hcnlLZXkgJiYgIWRyaXZlclN1cHBvcnRzRGVmYXVsdFVVSURcbiAgICB0aGlzLl9zZXREZWZhdWx0VGltZXN0YW1wVmFsdWVzKGRhdGEpXG5cbiAgICBjb25zdCBjb2x1bW5OYW1lcyA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldENvbHVtbk5hbWVzKClcbiAgICBjb25zdCBoYXNVc2VyUHJvdmlkZWRQcmltYXJ5S2V5ID0gZGF0YVtwcmltYXJ5S2V5XSAhPT0gdW5kZWZpbmVkICYmIGRhdGFbcHJpbWFyeUtleV0gIT09IG51bGwgJiYgZGF0YVtwcmltYXJ5S2V5XSAhPT0gXCJcIlxuXG4gICAgaWYgKHNob3VsZEFzc2lnblVVSURQcmltYXJ5S2V5ICYmICFoYXNVc2VyUHJvdmlkZWRQcmltYXJ5S2V5KSB7XG4gICAgICBkYXRhW3ByaW1hcnlLZXldID0gbmV3IFVVSUQoNCkuZm9ybWF0KClcbiAgICB9XG5cbiAgICB0aGlzLl9ub3JtYWxpemVEYXRlVmFsdWVzRm9yV3JpdGUoZGF0YSlcblxuICAgIGNvbnN0IHNxbCA9IGNvbm5lY3Rpb24uaW5zZXJ0U3FsKHtcbiAgICAgIHJldHVybkxhc3RJbnNlcnRlZENvbHVtbk5hbWVzOiBjb2x1bW5OYW1lcyxcbiAgICAgIHRhYmxlTmFtZTogdGhpcy5fdGFibGVOYW1lKCksXG4gICAgICBkYXRhXG4gICAgfSlcbiAgICBjb25zdCBpbnNlcnRPcHRpb25zID0ge2xvZ05hbWU6IGAke3RoaXMuZ2V0TW9kZWxDbGFzcygpLm5hbWV9IENyZWF0ZWB9XG4gICAgLy8gRXhwbGljaXQgcHJpbWFyeS1rZXkgaW5zZXJ0cyBpbnRvIGF1dG8taW5jcmVtZW50IGNvbHVtbnMgZ28gdGhyb3VnaCB0aGVcbiAgICAvLyBkcml2ZXIncyBleHBsaWNpdC1wcmltYXJ5LWtleSBpbnNlcnQgKE1TU1FMIHdyYXBzIGl0IGluIElERU5USVRZX0lOU0VSVCk7XG4gICAgLy8gZXZlcnl0aGluZyBlbHNlIHVzZXMgdGhlIHBsYWluIHF1ZXJ5IHBhdGguXG4gICAgY29uc3QgaW5zZXJ0UmVzdWx0ID0gaGFzVXNlclByb3ZpZGVkUHJpbWFyeUtleSAmJiBwcmltYXJ5S2V5Q29sdW1uPy5nZXRBdXRvSW5jcmVtZW50KCkgPT09IHRydWVcbiAgICAgID8gYXdhaXQgY29ubmVjdGlvbi5pbnNlcnRXaXRoRXhwbGljaXRQcmltYXJ5S2V5KHtvcHRpb25zOiBpbnNlcnRPcHRpb25zLCBzcWwsIHRhYmxlTmFtZTogdGhpcy5fdGFibGVOYW1lKCl9KVxuICAgICAgOiBhd2FpdCBjb25uZWN0aW9uLnF1ZXJ5KHNxbCwgaW5zZXJ0T3B0aW9ucylcblxuICAgIGF3YWl0IHRoaXMuX2FwcGx5SW5zZXJ0UmVzdWx0KHtjb25uZWN0aW9uLCBkYXRhLCBpbnNlcnRSZXN1bHQsIHByaW1hcnlLZXl9KVxuICAgIHRoaXMuc2V0SXNOZXdSZWNvcmQoZmFsc2UpXG5cbiAgICB0aGlzLl9tYXJrTG9hZGVkUmVsYXRpb25zaGlwc1ByZWxvYWRlZEFmdGVyQ3JlYXRlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBNYXJrcyBvbmx5IHJlbGF0aW9uc2hpcHMgd2l0aCBpbi1tZW1vcnkgbG9hZGVkIHZhbHVlcyBhcyBwcmVsb2FkZWQgYWZ0ZXIgY3JlYXRlLlxuICAgKiBAcmV0dXJucyB7dm9pZH0gLSBObyByZXR1cm4gdmFsdWUuXG4gICAqL1xuICBfbWFya0xvYWRlZFJlbGF0aW9uc2hpcHNQcmVsb2FkZWRBZnRlckNyZWF0ZSgpIHtcbiAgICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcCBvZiB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRSZWxhdGlvbnNoaXBzKCkpIHtcbiAgICAgIGNvbnN0IGluc3RhbmNlUmVsYXRpb25zaGlwID0gdGhpcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUocmVsYXRpb25zaGlwLmdldFJlbGF0aW9uc2hpcE5hbWUoKSlcblxuICAgICAgaWYgKGluc3RhbmNlUmVsYXRpb25zaGlwLmdldFR5cGUoKSA9PSBcImhhc01hbnlcIiAmJiBpbnN0YW5jZVJlbGF0aW9uc2hpcC5nZXRMb2FkZWRPclVuZGVmaW5lZCgpID09PSBudWxsKSB7XG4gICAgICAgIGluc3RhbmNlUmVsYXRpb25zaGlwLnNldExvYWRlZChbXSlcbiAgICAgIH1cblxuICAgICAgaWYgKGluc3RhbmNlUmVsYXRpb25zaGlwLmdldExvYWRlZE9yVW5kZWZpbmVkKCkgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBpbnN0YW5jZVJlbGF0aW9uc2hpcC5zZXRQcmVsb2FkZWQodHJ1ZSlcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQXBwbGllcyB0aGUgZGF0YWJhc2UgaW5zZXJ0IHJlc3BvbnNlIHRvIHRoaXMgcmVjb3JkLlxuICAgKiBAcGFyYW0ge3tjb25uZWN0aW9uOiBpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdCwgZGF0YTogUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbiB8IERhdGUgfCBudWxsIHwgdW5kZWZpbmVkPiwgaW5zZXJ0UmVzdWx0OiBBcnJheTxSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBudW1iZXIgfCBib29sZWFuIHwgRGF0ZSB8IG51bGwgfCB1bmRlZmluZWQ+PiB8IG51bGwgfCB1bmRlZmluZWQsIHByaW1hcnlLZXk6IHN0cmluZ319IG9wdGlvbnMgLSBQaW5uZWQgaW5zZXJ0IGNvbm5lY3Rpb24sIGluc2VydGVkIGRhdGEsIGNvbm5lY3Rpb24gcmVzdWx0LCBhbmQgcHJpbWFyeSBrZXkgY29sdW1uIG5hbWUuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBfYXBwbHlJbnNlcnRSZXN1bHQoe2Nvbm5lY3Rpb24sIGRhdGEsIGluc2VydFJlc3VsdCwgcHJpbWFyeUtleX0pIHtcbiAgICBpZiAoQXJyYXkuaXNBcnJheShpbnNlcnRSZXN1bHQpICYmIGluc2VydFJlc3VsdFswXSAmJiBpbnNlcnRSZXN1bHRbMF1bcHJpbWFyeUtleV0pIHtcbiAgICAgIHRoaXMuX2F0dHJpYnV0ZXMgPSBpbnNlcnRSZXN1bHRbMF1cbiAgICAgIHRoaXMuX2NoYW5nZXMgPSB7fVxuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBwcmltYXJ5S2V5VmFsdWUgPSBkYXRhW3ByaW1hcnlLZXldXG5cbiAgICAgIGlmIChwcmltYXJ5S2V5VmFsdWUgIT09IHVuZGVmaW5lZCAmJiBwcmltYXJ5S2V5VmFsdWUgIT09IG51bGwgJiYgcHJpbWFyeUtleVZhbHVlICE9PSBcIlwiKSB7XG4gICAgICAgIGlmICh0eXBlb2YgcHJpbWFyeUtleVZhbHVlICE9IFwic3RyaW5nXCIgJiYgdHlwZW9mIHByaW1hcnlLZXlWYWx1ZSAhPSBcIm51bWJlclwiKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnNlcnRlZCBwcmltYXJ5IGtleSAke3ByaW1hcnlLZXl9IG11c3QgYmUgYSBzdHJpbmcgb3IgbnVtYmVyLCBnb3QgJHt0eXBlb2YgcHJpbWFyeUtleVZhbHVlfWApXG4gICAgICAgIH1cblxuICAgICAgICBhd2FpdCB0aGlzLl9yZWxvYWRXaXRoSWQocHJpbWFyeUtleVZhbHVlKVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgY29uc3QgaWQgPSBhd2FpdCBjb25uZWN0aW9uLmxhc3RJbnNlcnRJRCgpXG5cbiAgICAgIGF3YWl0IHRoaXMuX3JlbG9hZFdpdGhJZChpZClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU2V0cyB0aW1lc3RhbXAgZGVmYXVsdHMgZm9yIGEgbmV3IHJlY29yZCBpbnNlcnQuXG4gICAqIEBwYXJhbSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBkYXRhIC0gQ29sdW1uLWtleWVkIGRhdGEuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIF9zZXREZWZhdWx0VGltZXN0YW1wVmFsdWVzKGRhdGEpIHtcbiAgICBjb25zdCBjcmVhdGVkQXRDb2x1bW4gPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRDb2x1bW5zKCkuZmluZCgoY29sdW1uKSA9PiBjb2x1bW4uZ2V0TmFtZSgpID09IFwiY3JlYXRlZF9hdFwiKVxuICAgIGNvbnN0IHVwZGF0ZWRBdENvbHVtbiA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldENvbHVtbnMoKS5maW5kKChjb2x1bW4pID0+IGNvbHVtbi5nZXROYW1lKCkgPT0gXCJ1cGRhdGVkX2F0XCIpXG4gICAgY29uc3QgY3VycmVudERhdGUgPSBuZXcgRGF0ZSgpXG5cbiAgICBpZiAoY3JlYXRlZEF0Q29sdW1uICYmIChkYXRhLmNyZWF0ZWRfYXQgPT09IHVuZGVmaW5lZCB8fCBkYXRhLmNyZWF0ZWRfYXQgPT09IG51bGwgfHwgZGF0YS5jcmVhdGVkX2F0ID09PSBcIlwiKSkge1xuICAgICAgZGF0YS5jcmVhdGVkX2F0ID0gY3VycmVudERhdGVcbiAgICB9XG4gICAgaWYgKHVwZGF0ZWRBdENvbHVtbiAmJiAoZGF0YS51cGRhdGVkX2F0ID09PSB1bmRlZmluZWQgfHwgZGF0YS51cGRhdGVkX2F0ID09PSBudWxsIHx8IGRhdGEudXBkYXRlZF9hdCA9PT0gXCJcIikpIHtcbiAgICAgIGRhdGEudXBkYXRlZF9hdCA9IGN1cnJlbnREYXRlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIGRhdGUgdmFsdWVzIGZvciB3cml0ZS5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IGRhdGEgLSBDb2x1bW4ta2V5ZWQgZGF0YS5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgX25vcm1hbGl6ZURhdGVWYWx1ZXNGb3JXcml0ZShkYXRhKSB7XG4gICAgZm9yIChjb25zdCBjb2x1bW5OYW1lIGluIGRhdGEpIHtcbiAgICAgIGNvbnN0IGNvbHVtblR5cGUgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRDb2x1bW5UeXBlQnlOYW1lKGNvbHVtbk5hbWUpXG5cbiAgICAgIGlmICghY29sdW1uVHlwZSB8fCAhdGhpcy5nZXRNb2RlbENsYXNzKCkuX2lzRGF0ZUxpa2VUeXBlKGNvbHVtblR5cGUpKSBjb250aW51ZVxuXG4gICAgICBjb25zdCB2YWx1ZSA9IGRhdGFbY29sdW1uTmFtZV1cblxuICAgICAgZGF0YVtjb2x1bW5OYW1lXSA9IG5vcm1hbGl6ZURhdGVWYWx1ZUZvcldyaXRlKHZhbHVlLCB7dGltZVpvbmU6IHRoaXMuZ2V0TW9kZWxDbGFzcygpLl90aW1lWm9uZUZvckRhdGVXcml0ZSgpfSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyB1cGRhdGUgcmVjb3JkIHdpdGggY2hhbmdlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIF91cGRhdGVSZWNvcmRXaXRoQ2hhbmdlcygpIHtcbiAgICAvKipcbiAgICAgKiBDb25kaXRpb25zLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgY29uZGl0aW9ucyA9IHt9XG5cbiAgICBjb25kaXRpb25zW3RoaXMuZ2V0TW9kZWxDbGFzcygpLnByaW1hcnlLZXkoKV0gPSB0aGlzLmlkKClcblxuICAgIGNvbnN0IGNoYW5nZXMgPSBPYmplY3QuYXNzaWduKHt9LCB0aGlzLl9iZWxvbmdzVG9DaGFuZ2VzKCksIHRoaXMuX2NoYW5nZXMpXG4gICAgY29uc3QgdXBkYXRlZEF0Q29sdW1uID0gdGhpcy5nZXRNb2RlbENsYXNzKCkuZ2V0Q29sdW1ucygpLmZpbmQoKGNvbHVtbikgPT4gY29sdW1uLmdldE5hbWUoKSA9PSBcInVwZGF0ZWRfYXRcIilcbiAgICBjb25zdCBjdXJyZW50RGF0ZSA9IG5ldyBEYXRlKClcblxuICAgIGlmICh1cGRhdGVkQXRDb2x1bW4gJiYgKGNoYW5nZXMudXBkYXRlZF9hdCA9PT0gdW5kZWZpbmVkIHx8IGNoYW5nZXMudXBkYXRlZF9hdCA9PT0gbnVsbCB8fCBjaGFuZ2VzLnVwZGF0ZWRfYXQgPT09IFwiXCIpKSB7XG4gICAgICBjaGFuZ2VzLnVwZGF0ZWRfYXQgPSBjdXJyZW50RGF0ZVxuICAgIH1cblxuICAgIGlmIChPYmplY3Qua2V5cyhjaGFuZ2VzKS5sZW5ndGggPiAwKSB7XG4gICAgICB0aGlzLl9ub3JtYWxpemVEYXRlVmFsdWVzRm9yV3JpdGUoY2hhbmdlcylcbiAgICAgIGNvbnN0IHNxbCA9IHRoaXMuX2Nvbm5lY3Rpb24oKS51cGRhdGVTcWwoe1xuICAgICAgICB0YWJsZU5hbWU6IHRoaXMuX3RhYmxlTmFtZSgpLFxuICAgICAgICBkYXRhOiBjaGFuZ2VzLFxuICAgICAgICBjb25kaXRpb25zXG4gICAgICB9KVxuICAgICAgYXdhaXQgdGhpcy5fY29ubmVjdGlvbigpLnF1ZXJ5KHNxbCwge2xvZ05hbWU6IGAke3RoaXMuZ2V0TW9kZWxDbGFzcygpLm5hbWV9IFVwZGF0ZWB9KVxuICAgICAgYXdhaXQgdGhpcy5fcmVsb2FkV2l0aElkKHRoaXMuaWQoKSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBpZC5cbiAgICogQHJldHVybnMge251bWJlcnxzdHJpbmd9IC0gVGhlIGlkLlxuICAgKi9cbiAgaWQoKSB7XG4gICAgaWYgKCF0aGlzLmdldE1vZGVsQ2xhc3MoKS5fY29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb2x1bW4gbmFtZXMgbWFwcGluZyBoYXNuJ3QgYmVlbiBzZXQgb24gJHt0aGlzLmNvbnN0cnVjdG9yLm5hbWV9LiBIYXMgdGhlIG1vZGVsIGJlZW4gaW5pdGlhbGl6ZWQ/YClcbiAgICB9XG5cbiAgICBjb25zdCBwcmltYXJ5S2V5ID0gdGhpcy5nZXRNb2RlbENsYXNzKCkucHJpbWFyeUtleSgpXG4gICAgY29uc3QgYXR0cmlidXRlTmFtZSA9IHRoaXMuZ2V0TW9kZWxDbGFzcygpLmdldENvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXAoKVtwcmltYXJ5S2V5XVxuXG4gICAgaWYgKGF0dHJpYnV0ZU5hbWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBQcmltYXJ5IGtleSAke3ByaW1hcnlLZXl9IGRvZXNuJ3QgZXhpc3QgaW4gY29sdW1uczogJHtPYmplY3Qua2V5cyh0aGlzLmdldE1vZGVsQ2xhc3MoKS5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKCkpLmpvaW4oXCIsIFwiKX1gKVxuICAgIH1cblxuICAgIHJldHVybiAvKiogQHR5cGUge251bWJlciB8IHN0cmluZ30gKi8gKHRoaXMucmVhZEF0dHJpYnV0ZShhdHRyaWJ1dGVOYW1lKSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIHBlcnNpc3RlZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBwZXJzaXN0ZWQuXG4gICAqL1xuICBpc1BlcnNpc3RlZCgpIHsgcmV0dXJuICF0aGlzLl9pc05ld1JlY29yZCB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgaXMgbmV3IHJlY29yZC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBuZXcgcmVjb3JkLlxuICAgKi9cbiAgaXNOZXdSZWNvcmQoKSB7IHJldHVybiB0aGlzLl9pc05ld1JlY29yZCB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2V0IGlzIG5ldyByZWNvcmQuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gbmV3SXNOZXdSZWNvcmQgLSBOZXcgaXMgbmV3IHJlY29yZC5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgc2V0SXNOZXdSZWNvcmQobmV3SXNOZXdSZWNvcmQpIHtcbiAgICB0aGlzLl9pc05ld1JlY29yZCA9IG5ld0lzTmV3UmVjb3JkXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZWxvYWQgd2l0aCBpZC5cbiAgICogQHRlbXBsYXRlIHt0eXBlb2YgVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmR9IE1DXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgbnVtYmVyfSBpZCAtIFJlY29yZCBpZGVudGlmaWVyLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgX3JlbG9hZFdpdGhJZChpZCkge1xuICAgIGNvbnN0IHByaW1hcnlLZXkgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5wcmltYXJ5S2V5KClcblxuICAgIC8qKlxuICAgICAqIFdoZXJlIG9iamVjdC5cbiAgICAgKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IHdoZXJlT2JqZWN0ID0ge31cblxuICAgIHdoZXJlT2JqZWN0W3ByaW1hcnlLZXldID0gaWRcblxuICAgIGNvbnN0IHF1ZXJ5ID0gLyoqIEB0eXBlIHtpbXBvcnQoXCIuLi9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PE1DPn0gKi8gKFxuICAgICAgdGhpc1xuICAgICAgICAucXVlcnlGb3JNb2RlbCh0aGlzLmdldE1vZGVsQ2xhc3MoKSlcbiAgICAgICAgLndoZXJlKHdoZXJlT2JqZWN0KVxuICAgIClcbiAgICBjb25zdCByZWxvYWRlZE1vZGVsID0gYXdhaXQgcXVlcnkuZmlyc3QoKVxuXG4gICAgaWYgKCFyZWxvYWRlZE1vZGVsKSB0aHJvdyBuZXcgRXJyb3IoYCR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfSMke2lkfSBjb3VsZG4ndCBiZSByZWxvYWRlZCAtIHJlY29yZCBkaWRuJ3QgZXhpc3RgKVxuXG4gICAgdGhpcy5fYXR0cmlidXRlcyA9IHJlbG9hZGVkTW9kZWwucmF3QXR0cmlidXRlcygpXG4gICAgdGhpcy5fY2hhbmdlcyA9IHt9XG4gICAgdGhpcy5fYXNzaWduZWRBdHRyaWJ1dGVOYW1lcyA9IHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgcmVsb2FkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgcmVsb2FkKCkge1xuICAgIGNvbnN0IHJlY29yZElkID0gLyoqIEB0eXBlIHtzdHJpbmcgfCBudW1iZXJ9ICovICh0aGlzLnJlYWRBdHRyaWJ1dGUoXCJpZFwiKSlcbiAgICBhd2FpdCB0aGlzLl9yZWxvYWRXaXRoSWQocmVjb3JkSWQpXG4gIH1cblxuICBhc3luYyBfcnVuVmFsaWRhdGlvbnMoKSB7XG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCB7dHlwZTogc3RyaW5nLCBtZXNzYWdlOiBzdHJpbmd9Pn0gKi9cbiAgICB0aGlzLl92YWxpZGF0aW9uRXJyb3JzID0ge31cblxuICAgIGNvbnN0IHZhbGlkYXRvcnMgPSB0aGlzLmdldE1vZGVsQ2xhc3MoKS5fdmFsaWRhdG9yc1xuXG4gICAgaWYgKHZhbGlkYXRvcnMpIHtcbiAgICAgIGZvciAoY29uc3QgYXR0cmlidXRlTmFtZSBpbiB2YWxpZGF0b3JzKSB7XG4gICAgICAgIGNvbnN0IGF0dHJpYnV0ZVZhbGlkYXRvcnMgPSB2YWxpZGF0b3JzW2F0dHJpYnV0ZU5hbWVdXG5cbiAgICAgICAgZm9yIChjb25zdCB2YWxpZGF0b3Igb2YgYXR0cmlidXRlVmFsaWRhdG9ycykge1xuICAgICAgICAgIGF3YWl0IHZhbGlkYXRvci52YWxpZGF0ZSh7bW9kZWw6IHRoaXMsIGF0dHJpYnV0ZU5hbWV9KVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKE9iamVjdC5rZXlzKHRoaXMuX3ZhbGlkYXRpb25FcnJvcnMpLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IHZhbGlkYXRpb25FcnJvciA9IG5ldyBWYWxpZGF0aW9uRXJyb3IodGhpcy5mdWxsRXJyb3JNZXNzYWdlcygpLmpvaW4oXCIuIFwiKSlcblxuICAgICAgdmFsaWRhdGlvbkVycm9yLnNldFZhbGlkYXRpb25FcnJvcnModGhpcy5fdmFsaWRhdGlvbkVycm9ycylcbiAgICAgIHZhbGlkYXRpb25FcnJvci5zZXRNb2RlbCh0aGlzKVxuICAgICAgdmFsaWRhdGlvbkVycm9yLnZlbG9jaW91cyA9IHt0eXBlOiBcInZhbGlkYXRpb25fZXJyb3JcIn1cblxuICAgICAgdGhyb3cgdmFsaWRhdGlvbkVycm9yXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZnVsbCBlcnJvciBtZXNzYWdlcy5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSAtIFRoZSBmdWxsIGVycm9yIG1lc3NhZ2VzLlxuICAgKi9cbiAgZnVsbEVycm9yTWVzc2FnZXMoKSB7XG4gICAgLyoqXG4gICAgICogVmFsaWRhdGlvbiBlcnJvciBtZXNzYWdlcy5cbiAgICAgKiBAdHlwZSB7c3RyaW5nW119ICovXG4gICAgY29uc3QgdmFsaWRhdGlvbkVycm9yTWVzc2FnZXMgPSBbXVxuXG4gICAgaWYgKHRoaXMuX3ZhbGlkYXRpb25FcnJvcnMpIHtcbiAgICAgIGZvciAoY29uc3QgYXR0cmlidXRlTmFtZSBpbiB0aGlzLl92YWxpZGF0aW9uRXJyb3JzKSB7XG4gICAgICAgIGZvciAoY29uc3QgdmFsaWRhdGlvbkVycm9yIG9mIHRoaXMuX3ZhbGlkYXRpb25FcnJvcnNbYXR0cmlidXRlTmFtZV0pIHtcbiAgICAgICAgICBjb25zdCBtZXNzYWdlID0gYCR7dGhpcy5nZXRNb2RlbENsYXNzKCkuaHVtYW5BdHRyaWJ1dGVOYW1lKGF0dHJpYnV0ZU5hbWUpfSAke3ZhbGlkYXRpb25FcnJvci5tZXNzYWdlfWBcblxuICAgICAgICAgIHZhbGlkYXRpb25FcnJvck1lc3NhZ2VzLnB1c2gobWVzc2FnZSlcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB2YWxpZGF0aW9uRXJyb3JNZXNzYWdlc1xuICB9XG5cbiAgLyoqXG4gICAqIEFzc2lnbnMgdGhlIGF0dHJpYnV0ZXMgdG8gdGhlIHJlY29yZCBhbmQgc2F2ZXMgaXQuXG4gICAqIEBwYXJhbSB7V3JpdGVBdHRyaWJ1dGVzfSBhdHRyaWJ1dGVzVG9Bc3NpZ24gLSBUaGUgYXR0cmlidXRlcyB0byBhc3NpZ24gdG8gdGhlIHJlY29yZC5cbiAgICovXG4gIGFzeW5jIHVwZGF0ZShhdHRyaWJ1dGVzVG9Bc3NpZ24pIHtcbiAgICBpZiAoYXR0cmlidXRlc1RvQXNzaWduKSB0aGlzLmFzc2lnbihhdHRyaWJ1dGVzVG9Bc3NpZ24pXG5cbiAgICBhd2FpdCB0aGlzLnNhdmUoKVxuICB9XG59XG5cblZlbG9jaW91c0RhdGFiYXNlUmVjb3JkLnJlZ2lzdGVyVmFsaWRhdG9yVHlwZShcImZvcm1hdFwiLCBWYWxpZGF0b3JzRm9ybWF0KVxuVmVsb2Npb3VzRGF0YWJhc2VSZWNvcmQucmVnaXN0ZXJWYWxpZGF0b3JUeXBlKFwibGVuZ3RoXCIsIFZhbGlkYXRvcnNMZW5ndGgpXG5WZWxvY2lvdXNEYXRhYmFzZVJlY29yZC5yZWdpc3RlclZhbGlkYXRvclR5cGUoXCJwcmVzZW5jZVwiLCBWYWxpZGF0b3JzUHJlc2VuY2UpXG5WZWxvY2lvdXNEYXRhYmFzZVJlY29yZC5yZWdpc3RlclZhbGlkYXRvclR5cGUoXCJ1bmlxdWVuZXNzXCIsIFZhbGlkYXRvcnNVbmlxdWVuZXNzKVxuXG5leHBvcnQge0Fkdmlzb3J5TG9ja0J1c3lFcnJvciwgQWR2aXNvcnlMb2NrSG9sZFRpbWVvdXRFcnJvciwgQWR2aXNvcnlMb2NrVGltZW91dEVycm9yLCBUZW5hbnREYXRhYmFzZVNjb3BlRXJyb3IsIFZhbGlkYXRpb25FcnJvcn1cbmV4cG9ydCBkZWZhdWx0IFZlbG9jaW91c0RhdGFiYXNlUmVjb3JkXG4iXX0=