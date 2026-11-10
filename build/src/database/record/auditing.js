// @ts-check
import UUID from "pure-uuid";
import * as inflection from "inflection";
import HasManyRelationship from "./relationships/has-many.js";
import { scalarModelPrimaryKey, scalarModelPrimaryKeyValue } from "../../utils/model-primary-key.js";
/**
 * Global audit event bus matching ActiveRecordAuditable::Events.
 * @typedef {object} AuditEventsType
 * @property {(type: string, action: string, args: AuditEventPayload) => void} call - Fire all callbacks for a model type + action.
 * @property {(type: string, action: string, callback: (args: AuditEventPayload) => void) => () => void} connect - Register a callback for a model type + action. Returns an unsubscribe function.
 * @property {() => void} reset - Clear all registered callbacks.
 */
/**
 * AuditChanges type.
 * @typedef {Record<string, ReturnType<typeof JSON.parse>>} AuditChanges
 */
/**
 * AuditEventPayload type.
 * @typedef {object} AuditEventPayload
 * @property {string} action - Audit action name.
 * @property {number | string} auditId - Created audit row id.
 * @property {AuditChanges | null} auditedChanges - Changes captured for the audit.
 * @property {Record<string, ReturnType<typeof JSON.parse>> | null} params - Optional caller-supplied audit params.
 * @property {import("./index.js").default} record - Audited record.
 */
/**
 * AuditCallback type.
 * @typedef {(payload: AuditEventPayload) => void | Promise<void>} AuditCallback
 */
/**
 * CreateAuditArgs type.
 * @typedef {object} CreateAuditArgs
 * @property {string} action - Audit action name.
 * @property {AuditChanges | null} [auditedChanges] - Explicit changes to persist.
 * @property {Record<string, ReturnType<typeof JSON.parse>> | null} [params] - Optional metadata to store with the audit.
 */
/**
 * AuditedModelClass type.
 * @typedef {typeof import("./index.js").default & {
 *   _auditCallbacks?: Record<string, AuditCallback[]>,
 *   _auditLifecycleCallbacksRegistered?: boolean,
 *   _auditTableResolved?: boolean,
 *   _auditTableData?: AuditTableData
 * }} AuditedModelClass
 */
/**
 * AuditTableData type.
 * @typedef {object} AuditTableData
 * @property {boolean} dedicated - Whether a dedicated audit table exists.
 * @property {string} tableName - Name of the audit table.
 * @property {string} foreignKey - Column name that references the audited model.
 * @property {typeof import("./index.js").default} auditClass - The audit model class to use.
 */
/** @type {WeakMap<import("../../configuration.js").default, Map<string, boolean>>} */
const dedicatedTableCacheByConfiguration = new WeakMap();
/** @type {WeakMap<AuditedModelClass, Map<string, AuditTableData>>} */
const auditTableDataByModel = new WeakMap();
/** @type {Map<string, typeof import("./index.js").default>} */
const auditClassCache = new Map();
const generatedAuditRelationships = new WeakSet();
/** @type {WeakMap<AuditedModelClass, Map<string, HasManyRelationship>>} */
const auditRelationshipsByModel = new WeakMap();
// ---------------------------------------------------------------------------
// Global event bus (like ActiveRecordAuditable::Events)
// ---------------------------------------------------------------------------
/** @type {Record<string, Record<string, Array<(args: AuditEventPayload) => void>>>} */
let globalEventConnections = {};
/** @type {AuditEventsType} */
const AuditEvents = {
    /**
     * Fire all registered callbacks for a model type and action.
     * @param {string} type - Audited model type whose listeners should fire.
     * @param {string} action - Audit action whose listeners should fire.
     * @param {AuditEventPayload} args - Audit event delivered to matching listeners.
     */
    call(type, action, args) {
        const actions = globalEventConnections[type] || {};
        const callbacks = actions[action] || [];
        for (const callback of [...callbacks]) {
            callback(args);
        }
    },
    /**
     * Register a callback for a model type and action.
     * @param {string} type - Audited model type to observe.
     * @param {string} action - Audit action to observe.
     * @param {(args: AuditEventPayload) => void} callback - Listener invoked for matching audit events.
     * @returns {() => void} - Callback that removes the registration.
     */
    connect(type, action, callback) {
        if (!globalEventConnections[type]) {
            globalEventConnections[type] = {};
        }
        if (!globalEventConnections[type][action]) {
            globalEventConnections[type][action] = [];
        }
        globalEventConnections[type][action].push(callback);
        return () => {
            const list = globalEventConnections[type]?.[action];
            if (list) {
                const index = list.indexOf(callback);
                if (index >= 0) {
                    list.splice(index, 1);
                }
            }
        };
    },
    /** Clear all registered callbacks. */
    reset() {
        globalEventConnections = {};
    }
};
// ---------------------------------------------------------------------------
// Table detection
// ---------------------------------------------------------------------------
/**
 * Returns the dedicated audit table name for a model class.
 * @param {AuditedModelClass} modelClass - Audited model class.
 * @returns {string} e.g. "project_audits" for a "projects" table.
 */
function dedicatedAuditTableName(modelClass) {
    const table = modelClass.tableName();
    if (table.endsWith("s")) {
        return `${table.slice(0, -1)}_audits`;
    }
    return `${table}_audits`;
}
/**
 * Resolves audit table data for a model class. Cached per model.
 * Called lazily on first createAudit / withoutAudit / relationship usage.
 * @param {AuditedModelClass} modelClass - Audited model class.
 * @param {import("../drivers/base.js").default} [connection] - Explicit record-owned connection.
 * @param {import("../operation.js").default} [operation] - Explicit record operation.
 * @returns {Promise<AuditTableData>} Resolved audit table metadata.
 */
async function resolveAuditTableData(modelClass, connection, operation) {
    const resolvedConnection = connection || modelClass.connection();
    const databaseIdentity = auditDatabaseIdentity(modelClass, resolvedConnection, operation);
    let tableDataByIdentity = auditTableDataByModel.get(modelClass);
    if (!tableDataByIdentity) {
        tableDataByIdentity = new Map();
        auditTableDataByModel.set(modelClass, tableDataByIdentity);
    }
    const cachedTableData = tableDataByIdentity.get(databaseIdentity);
    if (cachedTableData) {
        registerAuditRelationship(modelClass, cachedTableData, databaseIdentity);
        return cachedTableData;
    }
    const tableData = await buildAuditTableData(modelClass, resolvedConnection, databaseIdentity);
    const configuration = modelClass._getConfiguration();
    tableData.auditClass.registerRecordClass({ configuration });
    await tableData.auditClass.initializeRecord({ configuration, connection: resolvedConnection });
    modelClass._auditTableData = tableData;
    modelClass._auditTableResolved = true;
    tableDataByIdentity.set(databaseIdentity, tableData);
    registerAuditRelationship(modelClass, tableData, databaseIdentity);
    return tableData;
}
/**
 * Builds audit table metadata for a model class. Prefers the consumer's
 * registered Audit model for shared tables; falls back to a framework-owned
 * dynamic class.
 * @param {AuditedModelClass} modelClass - Audited model class.
 * @param {import("../drivers/base.js").default} connection - Explicit record-owned connection.
 * @param {string} databaseIdentity - Captured physical database identity.
 * @returns {Promise<AuditTableData>} Audit table metadata.
 */
async function buildAuditTableData(modelClass, connection, databaseIdentity) {
    const dedicatedTable = dedicatedAuditTableName(modelClass);
    const dedicatedExists = await dedicatedTableExistsForConnection(modelClass, dedicatedTable, connection, databaseIdentity);
    if (dedicatedExists) {
        const auditClass = dedicatedAuditClass(modelClass, dedicatedTable);
        const foreignKey = modelForeignKey(modelClass);
        return {
            auditClass,
            dedicated: true,
            foreignKey,
            tableName: dedicatedTable
        };
    }
    const configuration = modelClass._getConfiguration();
    const consumerAuditClass = configuration.getModelClasses().Audit;
    if (consumerAuditClass) {
        return {
            auditClass: consumerAuditClass,
            dedicated: false,
            foreignKey: "auditable_id",
            tableName: "audits"
        };
    }
    return {
        auditClass: cachedSharedAuditClass(modelClass),
        dedicated: false,
        foreignKey: "auditable_id",
        tableName: "audits"
    };
}
/**
 * Checks whether a dedicated audit table exists for a model's connection.
 * @param {AuditedModelClass} modelClass - Audited model class owning the Configuration.
 * @param {string} tableName - Dedicated audit table name to check.
 * @param {import("../drivers/base.js").default} connection - Explicit record-owned connection.
 * @param {string} databaseIdentity - Captured physical database identity.
 * @returns {Promise<boolean>} Whether the table exists.
 */
async function dedicatedTableExistsForConnection(modelClass, tableName, connection, databaseIdentity) {
    const configuration = modelClass._getConfiguration();
    const cacheKey = `${databaseIdentity}:${tableName}`;
    let dedicatedTableCache = dedicatedTableCacheByConfiguration.get(configuration);
    if (!dedicatedTableCache) {
        dedicatedTableCache = new Map();
        dedicatedTableCacheByConfiguration.set(configuration, dedicatedTableCache);
    }
    const cached = dedicatedTableCache.get(cacheKey);
    if (typeof cached === "boolean") {
        return cached;
    }
    const table = await connection.getTableByName(tableName, { throwError: false });
    const exists = Boolean(table);
    dedicatedTableCache.set(cacheKey, exists);
    return exists;
}
/**
 * Resolves a cache identity from explicit operation ownership or the actual
 * stamped pool connection. Ambient tenant state is never used when an
 * operation is available.
 * @param {AuditedModelClass} modelClass - Audited model class.
 * @param {import("../drivers/base.js").default} connection - Actual connection.
 * @param {import("../operation.js").default} [operation] - Explicit operation.
 * @returns {string} - Physical database identity.
 */
function auditDatabaseIdentity(modelClass, connection, operation) {
    if (operation)
        return operation.databaseIdentity();
    const databaseIdentifier = modelClass.getDatabaseIdentifier();
    const pool = modelClass._getConfiguration().getDatabasePool(databaseIdentifier);
    return `${databaseIdentifier}:${pool.getConnectionConfigurationReuseKey(connection)}`;
}
// ---------------------------------------------------------------------------
// Dynamic audit classes
// ---------------------------------------------------------------------------
/**
 * Returns a framework-owned shared Audit class for the `audits` table.
 * This is only used when no consumer-registered Audit model exists.
 * @param {AuditedModelClass} modelClass - Any audited model class (used to locate DatabaseRecord).
 * @returns {typeof import("./index.js").default} Shared Audit model class.
 */
function sharedAuditClass(modelClass) {
    const dbRecordClass = findDatabaseRecordClass(modelClass);
    /**
     * Framework-owned Audit model for the shared `audits` table.
     */
    class Audit extends dbRecordClass {
        /**
         * Returns the backing table name.
         * @returns {string} - Shared `audits` table name.
         */
        static tableName() {
            return "audits";
        }
    }
    Object.defineProperty(Audit, "modelName", { value: "Audit", writable: false });
    applyAuditClassDatabaseRouting(modelClass, Audit);
    return /** @type {typeof import("./index.js").default} */ (Audit);
}
/**
 * Returns the cached framework-owned shared Audit class for a database.
 * @param {AuditedModelClass} modelClass - Any audited model class.
 * @returns {typeof import("./index.js").default} Shared Audit model class.
 */
function cachedSharedAuditClass(modelClass) {
    const routingKey = modelClass.hasTenantDatabaseIdentifierResolver()
        ? `tenant:${modelClass.getModelName()}`
        : `database:${modelClass.getConfiguredDatabaseIdentifier()}`;
    const cacheKey = `shared:${routingKey}`;
    let auditClass = auditClassCache.get(cacheKey);
    if (!auditClass) {
        auditClass = sharedAuditClass(modelClass);
        auditClassCache.set(cacheKey, auditClass);
    }
    return auditClass;
}
/**
 * Returns a dynamic per-model audit class for a dedicated table.
 * @param {AuditedModelClass} modelClass - Audited model class.
 * @param {string} tableName - Dedicated audit table name (e.g. "project_audits").
 * @returns {typeof import("./index.js").default} Dedicated audit model class.
 */
function dedicatedAuditClass(modelClass, tableName) {
    const dbRecordClass = findDatabaseRecordClass(modelClass);
    const modelName = modelClass.getModelName();
    const modelKey = modelParamKey(modelClass);
    /**
     * Framework-owned per-model Audit class.
     */
    class ModelAudit extends dbRecordClass {
        /**
         * Returns the backing table name.
         * @returns {string} - Dedicated audit table supplied for this model class.
         */
        static tableName() {
            return tableName;
        }
    }
    Object.defineProperty(ModelAudit, "modelName", { value: `${modelName}Audit`, writable: false });
    applyAuditClassDatabaseRouting(modelClass, ModelAudit);
    ModelAudit.belongsTo(modelKey, { className: modelName });
    return /** @type {typeof import("./index.js").default} */ (ModelAudit);
}
/**
 * Makes framework-owned audit classes read the same database as the audited model.
 * @param {AuditedModelClass} modelClass - Audited source model class.
 * @param {typeof import("./index.js").default} auditClass - Generated audit class.
 * @returns {void}
 */
function applyAuditClassDatabaseRouting(modelClass, auditClass) {
    auditClass.setDatabaseIdentifier(modelClass.getConfiguredDatabaseIdentifier());
    if (modelClass.hasTenantDatabaseIdentifierResolver()) {
        auditClass.switchesTenantDatabase(({ tenant }) => modelClass.getTenantDatabaseIdentifier(tenant));
    }
}
/**
 * Walks the prototype chain to find the root DatabaseRecord class.
 * @param {AuditedModelClass} modelClass - Audited model class.
 * @returns {typeof import("./index.js").default} Root DatabaseRecord class.
 */
function findDatabaseRecordClass(modelClass) {
    let recordClass = Object.getPrototypeOf(modelClass);
    while (recordClass && Object.getPrototypeOf(recordClass) !== Function.prototype) {
        recordClass = Object.getPrototypeOf(recordClass);
    }
    return /** @type {typeof import("./index.js").default} */ (recordClass);
}
/**
 * Returns the parameter-key name for a model class.
 * @param {AuditedModelClass} modelClass - Audited model class.
 * @returns {string} e.g. "project" for "Project".
 */
function modelParamKey(modelClass) {
    const name = modelClass.getModelName();
    return name.charAt(0).toLowerCase() + name.slice(1);
}
/**
 * Returns the database foreign-key column for a model class.
 * @param {AuditedModelClass} modelClass - Audited model class.
 * @returns {string} e.g. "project_id" for "Project".
 */
function modelForeignKey(modelClass) {
    return `${inflection.underscore(modelClass.getModelName())}_id`;
}
// ---------------------------------------------------------------------------
// Registration (sync — callbacks only; table detection deferred)
// ---------------------------------------------------------------------------
/**
 * Registers lifecycle callbacks for automatic create/update/destroy auditing.
 * Table detection and relationship registration happen lazily on first usage.
 * Called synchronously from Model.audited() at module-load time.
 * @param {AuditedModelClass} modelClass - Model class to audit.
 * @param {{except?: string[]}} [options] - Audit options: `except` lists attribute names never written to the audit trail (e.g. high-frequency telemetry columns).
 * @returns {void}
 */
function registerAuditing(modelClass, options = {}) {
    if (Object.prototype.hasOwnProperty.call(modelClass, "_auditLifecycleCallbacksRegistered") && modelClass._auditLifecycleCallbacksRegistered) {
        return;
    }
    const auditableModelClass = /** @type {AuditedModelClass & {_auditExcludedAttributes?: Set<string>}} */ (modelClass);
    auditableModelClass._auditLifecycleCallbacksRegistered = true;
    auditableModelClass._auditExcludedAttributes = new Set(options.except || []);
    registerAuditRelationship(modelClass);
    modelClass.beforeCreate("captureCreateAuditChanges");
    modelClass.afterCreate("createCreateAudit");
    modelClass.beforeUpdate("captureUpdateAuditChanges");
    modelClass.afterUpdate("createUpdateAudit");
    modelClass.afterDestroy("createDestroyAudit");
}
/**
 * Initializes audit metadata for audited model classes.
 * @param {typeof import("./index.js").default} modelClass - Model class to initialize.
 * @param {{resolveTableData?: boolean}} [args] - Initialization options.
 * @returns {Promise<void>}
 */
async function initializeAuditing(modelClass, args = {}) {
    const { resolveTableData = false } = args;
    const auditedModelClass = /** @type {AuditedModelClass} */ (modelClass);
    if (!auditedModelClass._auditLifecycleCallbacksRegistered) {
        return;
    }
    registerAuditRelationship(auditedModelClass);
    if (resolveTableData && shouldResolveAuditTableData(auditedModelClass)) {
        await resolveAuditTableData(auditedModelClass);
    }
}
/**
 * Resolves audit metadata after application and package model classes are registered.
 * @param {import("../../configuration.js").default} configuration - Configuration whose models should be finalized.
 * @returns {Promise<void>}
 */
async function initializeAuditedModelRelationships(configuration) {
    const modelClasses = Object.values(configuration.getModelClasses());
    const shouldResolveTableData = modelClasses.some((modelClass) => shouldResolveAuditTableData(modelClass));
    if (!shouldResolveTableData) {
        for (const modelClass of modelClasses) {
            await initializeAuditing(modelClass);
        }
        return;
    }
    await configuration.ensureConnections({ name: "Initialize audited model relationships" }, async () => {
        for (const modelClass of modelClasses) {
            await initializeAuditing(modelClass, { resolveTableData: true });
        }
    });
}
/**
 * Checks whether audit table metadata should be resolved for a model class.
 * @param {typeof import("./index.js").default} modelClass - Model class to inspect.
 * @returns {boolean} Whether table metadata resolution should run now.
 */
function shouldResolveAuditTableData(modelClass) {
    const auditedModelClass = /** @type {AuditedModelClass} */ (modelClass);
    if (!auditedModelClass._auditLifecycleCallbacksRegistered) {
        return false;
    }
    return Boolean(auditedModelClass._initialized) && canResolveAuditTableData(auditedModelClass);
}
/**
 * Registers the audits relationship without forcing audit table detection.
 * @param {AuditedModelClass} modelClass - Model class to audit.
 * @param {AuditTableData} [tableData] - Resolved audit table data when available.
 * @param {string} [databaseIdentity] - Resolved physical database identity.
 * @returns {void}
 */
function registerAuditRelationship(modelClass, tableData = defaultAuditRelationshipTableData(modelClass), databaseIdentity) {
    if (modelClass._relationshipExists("audits")) {
        const relationship = modelClass.getRelationshipByName("audits");
        if (generatedAuditRelationships.has(relationship) && databaseIdentity) {
            auditRelationshipMap(modelClass).set(databaseIdentity, buildAuditRelationship(modelClass, tableData));
        }
        return;
    }
    modelClass.hasMany("audits", auditRelationshipScope, {
        foreignKey: tableData.foreignKey,
        klass: tableData.auditClass,
        polymorphic: !tableData.dedicated
    });
    const relationship = modelClass.getRelationshipByName("audits");
    generatedAuditRelationships.add(relationship);
    relationship.setRecordResolver((record) => {
        const relationships = auditRelationshipMap(modelClass);
        const operation = record.databaseOperation();
        if (operation)
            return relationships.get(operation.databaseIdentity()) || relationship;
        if (relationships.size === 1)
            return [...relationships.values()][0];
        const identity = auditDatabaseIdentity(modelClass, record.connection());
        return relationships.get(identity) || relationship;
    });
}
/**
 * Returns physical audit relationship variants for a model.
 * @param {AuditedModelClass} modelClass - Audited model class.
 * @returns {Map<string, HasManyRelationship>} - Relationships keyed by physical database identity.
 */
function auditRelationshipMap(modelClass) {
    let relationships = auditRelationshipsByModel.get(modelClass);
    if (!relationships) {
        relationships = new Map();
        auditRelationshipsByModel.set(modelClass, relationships);
    }
    return relationships;
}
/**
 * Builds immutable-by-ownership audit relationship metadata for one physical database.
 * @param {AuditedModelClass} modelClass - Audited model class.
 * @param {AuditTableData} tableData - Resolved audit table data.
 * @returns {HasManyRelationship} - Physical relationship definition.
 */
function buildAuditRelationship(modelClass, tableData) {
    return new HasManyRelationship({
        foreignKey: tableData.foreignKey,
        klass: tableData.auditClass,
        modelClass,
        polymorphic: !tableData.dedicated,
        relationshipName: "audits",
        scope: auditRelationshipScope,
        type: "hasMany"
    });
}
/**
 * Returns unresolved shared-audit defaults for early relationship registration.
 * @param {AuditedModelClass} modelClass - Model class to audit.
 * @returns {AuditTableData} Shared audit relationship defaults.
 */
function defaultAuditRelationshipTableData(modelClass) {
    return {
        auditClass: cachedSharedAuditClass(modelClass),
        dedicated: false,
        foreignKey: "auditable_id",
        tableName: "audits"
    };
}
/**
 * Applies default audit ordering to generated audit relationships.
 * @param {import("../query/model-class-query.js").default<typeof import("./index.js").default>} query - Audit query.
 * @returns {import("../query/model-class-query.js").default<typeof import("./index.js").default>} Ordered audit query.
 */
function auditRelationshipScope(query) {
    return query.order({ column: "created_at", direction: "DESC" });
}
/**
 * Checks whether the current tenant context can resolve audit table data.
 * @param {AuditedModelClass} modelClass - Model class to inspect.
 * @returns {boolean} Whether audit table data can be resolved in the current scope.
 */
function canResolveAuditTableData(modelClass) {
    if (!modelClass.hasTenantDatabaseIdentifierResolver()) {
        return true;
    }
    const tenantDatabaseIdentifier = modelClass.getTenantDatabaseIdentifier();
    if (!tenantDatabaseIdentifier) {
        return false;
    }
    return modelClass._getConfiguration().isDatabaseIdentifierActive(tenantDatabaseIdentifier);
}
// ---------------------------------------------------------------------------
// Creating audits
// ---------------------------------------------------------------------------
/**
 * Creates an audit row for a record.
 * @param {import("./index.js").default} record - Record to audit.
 * @param {CreateAuditArgs} args - Audit row options (action, auditedChanges, params).
 * @returns {Promise<number | string>} Created audit row id.
 */
async function createAudit(record, args) {
    const modelClass = /** @type {AuditedModelClass} */ (record.getModelClass());
    const operation = record.databaseOperation();
    if (operation)
        return await createAuditWithCurrentConnection(record, args, modelClass);
    return await modelClass._getConfiguration().ensureConnections({ name: `${modelClass.getModelName()} audit` }, async () => {
        return await createAuditWithCurrentConnection(record, args, modelClass);
    });
}
/**
 * Creates an audit row using the current model database connection.
 * Routes to shared table or dedicated table based on resolved audit table data.
 * @param {import("./index.js").default} record - Record to audit.
 * @param {CreateAuditArgs} args - Audit row options (action, auditedChanges, params).
 * @param {AuditedModelClass} modelClass - Audited model class.
 * @returns {Promise<number | string>} Created audit row id.
 */
async function createAuditWithCurrentConnection(record, args, modelClass) {
    if (!record.isPersisted())
        throw new Error(`Cannot audit unpersisted ${modelClass.getModelName()} record`);
    const db = record.connection();
    const tableData = await resolveAuditTableData(modelClass, db, record.databaseOperation());
    const action = normalizeAction(args.action);
    const auditedChanges = args.auditedChanges === undefined ? null : args.auditedChanges;
    const params = args.params === undefined ? null : args.params;
    const currentDate = new Date();
    const recordId = scalarModelPrimaryKeyValue(record.id(), `Auditing for ${modelClass.name}`);
    const auditActionId = await findOrCreateLookupId({
        columnName: "action",
        currentDate,
        db,
        tableName: "audit_actions",
        value: action
    });
    const auditId = new UUID(4).format();
    if (tableData.dedicated) {
        const foreignKey = modelForeignKey(modelClass);
        await db.query(db.insertSql({
            returnLastInsertedColumnNames: ["id"],
            tableName: tableData.tableName,
            data: {
                id: auditId,
                [foreignKey]: recordId,
                audit_action_id: auditActionId,
                audited_changes: auditedChanges,
                params,
                created_at: currentDate,
                updated_at: currentDate
            }
        }));
    }
    else {
        const auditAuditableTypeId = await findOrCreateLookupId({
            columnName: "name",
            currentDate,
            db,
            tableName: "audit_auditable_types",
            value: modelClass.getModelName()
        });
        await db.query(db.insertSql({
            returnLastInsertedColumnNames: ["id"],
            tableName: "audits",
            data: {
                id: auditId,
                audit_action_id: auditActionId,
                audit_auditable_type_id: auditAuditableTypeId,
                auditable_id: recordId,
                auditable_type: modelClass.getModelName(),
                audited_changes: auditedChanges,
                params,
                created_at: currentDate,
                updated_at: currentDate
            }
        }));
    }
    await emitAuditEvent(modelClass, action, {
        action,
        auditId,
        auditedChanges,
        params,
        record
    });
    AuditEvents.call(modelClass.getModelName(), action, {
        action,
        auditId,
        auditedChanges,
        params,
        record
    });
    return auditId;
}
// ---------------------------------------------------------------------------
// Lifecycle callbacks
// ---------------------------------------------------------------------------
/**
 * Captures create changes before persistence clears the change set.
 * @param {import("./index.js").default & {_pendingCreateAuditChanges?: AuditChanges}} record - Record whose pending changes should be captured.
 * @returns {void}
 */
function captureCreateAuditChanges(record) {
    record._pendingCreateAuditChanges = auditChangesForCurrentChanges(record);
}
/**
 * Writes the create audit row for a model instance.
 * @param {import("./index.js").default & {_pendingCreateAuditChanges?: AuditChanges}} record - Record to audit.
 * @returns {Promise<void>}
 */
async function createCreateAudit(record) {
    await createAudit(record, {
        action: "create",
        auditedChanges: record._pendingCreateAuditChanges || null
    });
    record._pendingCreateAuditChanges = undefined;
}
/**
 * Captures update changes before persistence clears the change set.
 * @param {import("./index.js").default & {_pendingUpdateAuditChanges?: AuditChanges}} record - Record whose pending changes should be captured.
 * @returns {void}
 */
function captureUpdateAuditChanges(record) {
    record._pendingUpdateAuditChanges = auditChangesForCurrentChanges(record);
}
/**
 * Writes the update audit row for a model instance.
 * @param {import("./index.js").default & {_pendingUpdateAuditChanges?: AuditChanges}} record - Record to audit.
 * @returns {Promise<void>}
 */
async function createUpdateAudit(record) {
    const auditedChanges = record._pendingUpdateAuditChanges || null;
    record._pendingUpdateAuditChanges = undefined;
    if (!auditedChanges || Object.keys(auditedChanges).length <= 0)
        return;
    await createAudit(record, {
        action: "update",
        auditedChanges
    });
}
/**
 * Writes the destroy audit row for a model instance.
 * @param {import("./index.js").default} record - Record to audit.
 * @returns {Promise<void>}
 */
async function createDestroyAudit(record) {
    await createAudit(record, {
        action: "destroy",
        auditedChanges: auditChangesForDestroy(record)
    });
}
// ---------------------------------------------------------------------------
// Changes helpers
// ---------------------------------------------------------------------------
/**
 * Captures the new values for fields changed on a record.
 * @param {import("./index.js").default} record - Record whose pending changes should be captured.
 * @returns {AuditChanges} New values keyed by attribute name.
 */
function auditChangesForCurrentChanges(record) {
    const changes = record.changes();
    /** @type {AuditChanges} */
    const auditedChanges = {};
    const modelClass = /** @type {AuditedModelClass & {_auditExcludedAttributes?: Set<string>}} */ (record.getModelClass());
    const columnNameToAttributeName = modelClass.getColumnNameToAttributeNameMap();
    const excludedAttributes = modelClass._auditExcludedAttributes;
    for (const [attributeName, change] of Object.entries(changes)) {
        const auditedAttributeName = columnNameToAttributeName[attributeName] || attributeName;
        if (excludedAttributes && (excludedAttributes.has(auditedAttributeName) || excludedAttributes.has(attributeName))) {
            continue;
        }
        auditedChanges[auditedAttributeName] = change[1];
    }
    return auditedChanges;
}
/**
 * Captures the current attributes for a destroy audit.
 * @param {import("./index.js").default} record - Record being destroyed.
 * @returns {AuditChanges} Current attributes keyed by attribute name.
 */
function auditChangesForDestroy(record) {
    return { ...record.attributes() };
}
// ---------------------------------------------------------------------------
// withoutAudit
// ---------------------------------------------------------------------------
/**
 * Returns records without an audit row for the given action.
 * Uses shared-table defaults when table data is not yet resolved;
 * switches to the dedicated table path once resolved.
 * @template {AuditedModelClass} MC
 * @param {MC} modelClass - Model class to scope.
 * @param {string} action - Audit action to exclude.
 * @returns {import("../query/model-class-query.js").default<MC>} Query scoped to records without that audit action.
 */
function withoutAudit(modelClass, action) {
    const db = modelClass.connection();
    const databaseIdentity = auditDatabaseIdentity(modelClass, db);
    const tableData = auditTableDataByModel.get(modelClass)?.get(databaseIdentity);
    const modelTableSql = db.quoteTable(modelClass.tableName());
    const auditActionsTableSql = db.quoteTable("audit_actions");
    const primaryKey = scalarModelPrimaryKey(modelClass.primaryKey(), `withoutAudit for ${modelClass.name}`);
    const modelPrimaryKeySql = `${modelTableSql}.${db.quoteColumn(primaryKey)}`;
    const auditActionsIdSql = `${auditActionsTableSql}.${db.quoteColumn("id")}`;
    const auditActionsActionSql = `${auditActionsTableSql}.${db.quoteColumn("action")}`;
    if (tableData?.dedicated) {
        const foreignKey = modelForeignKey(modelClass);
        const auditsTableSql = db.quoteTable(tableData.tableName);
        const auditActionIdSql = `${auditsTableSql}.${db.quoteColumn("audit_action_id")}`;
        const modelIdSql = `${auditsTableSql}.${db.quoteColumn(foreignKey)}`;
        return modelClass
            .all()
            .where(`
        NOT EXISTS (
          SELECT 1
          FROM ${auditsTableSql}
          INNER JOIN ${auditActionsTableSql}
            ON ${auditActionsIdSql} = ${auditActionIdSql}
          WHERE ${modelIdSql} = ${modelPrimaryKeySql}
            AND ${auditActionsActionSql} = ${db.quote(normalizeAction(action))}
        )
      `);
    }
    const auditsTableSql = db.quoteTable("audits");
    const auditAuditableIdSql = `${auditsTableSql}.${db.quoteColumn("auditable_id")}`;
    const auditAuditableTypeSql = `${auditsTableSql}.${db.quoteColumn("auditable_type")}`;
    const auditActionIdSql = `${auditsTableSql}.${db.quoteColumn("audit_action_id")}`;
    return modelClass
        .all()
        .where(`
      NOT EXISTS (
        SELECT 1
        FROM ${auditsTableSql}
        INNER JOIN ${auditActionsTableSql}
          ON ${auditActionsIdSql} = ${auditActionIdSql}
        WHERE ${auditAuditableTypeSql} = ${db.quote(modelClass.getModelName())}
          AND ${auditAuditableIdSql} = ${modelPrimaryKeySql}
          AND ${auditActionsActionSql} = ${db.quote(normalizeAction(action))}
      )
    `);
}
// ---------------------------------------------------------------------------
// Event callbacks
// ---------------------------------------------------------------------------
/**
 * Registers a per-model callback fired after an audit row is created.
 * @param {AuditedModelClass} modelClass - Model class to observe.
 * @param {string} action - Audit action name (e.g. "create").
 * @param {AuditCallback} callback - Callback invoked after matching audit rows are created.
 * @returns {() => void} Unsubscribe function.
 */
function registerAuditCallback(modelClass, action, callback) {
    const normalizedAction = normalizeAction(action);
    const callbacks = auditCallbacksForModelClass(modelClass);
    if (!callbacks[normalizedAction]) {
        callbacks[normalizedAction] = [];
    }
    callbacks[normalizedAction].push(callback);
    return () => {
        const actionCallbacks = callbacks[normalizedAction];
        const index = actionCallbacks.indexOf(callback);
        if (index >= 0) {
            actionCallbacks.splice(index, 1);
        }
    };
}
/**
 * Emits per-model audit callbacks for a model/action pair.
 * @param {AuditedModelClass} modelClass - Model class.
 * @param {string} action - Audit action.
 * @param {AuditEventPayload} payload - Event payload.
 * @returns {Promise<void>}
 */
async function emitAuditEvent(modelClass, action, payload) {
    const callbacks = auditCallbacksForModelClass(modelClass)[action] || [];
    for (const callback of [...callbacks]) {
        await callback(payload);
    }
}
/**
 * Returns the per-model callback map.
 * @param {AuditedModelClass} modelClass - Model class.
 * @returns {Record<string, AuditCallback[]>} Callback map keyed by action.
 */
function auditCallbacksForModelClass(modelClass) {
    if (!Object.prototype.hasOwnProperty.call(modelClass, "_auditCallbacks")) {
        modelClass._auditCallbacks = {};
    }
    const callbacks = modelClass._auditCallbacks;
    if (!callbacks)
        throw new Error(`Audit callbacks weren't initialized for ${modelClass.getModelName()}`);
    return callbacks;
}
// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------
/**
 * Finds or creates a lookup row and returns its id.
 * @param {object} args - Options object.
 * @param {string} args.columnName - Lookup value column name.
 * @param {Date} args.currentDate - Timestamp to write when inserting.
 * @param {import("../drivers/base.js").default} args.db - Database driver.
 * @param {string} args.tableName - Lookup table name.
 * @param {string} args.value - Lookup value.
 * @returns {Promise<number | string>} Lookup row id.
 */
async function findOrCreateLookupId({ columnName, currentDate, db, tableName, value }) {
    await db.upsert({
        tableName,
        conflictColumns: [columnName],
        updateColumns: [columnName],
        data: {
            id: new UUID(4).format(),
            [columnName]: value,
            created_at: currentDate,
            updated_at: currentDate
        }
    });
    const id = await findLookupId({ columnName, db, tableName, value });
    if (id === null)
        throw new Error(`Couldn't find ${tableName}.${columnName} after upsert`);
    return id;
}
/**
 * Finds a lookup id by value.
 * @param {object} args - Options object.
 * @param {string} args.columnName - Lookup value column name.
 * @param {import("../drivers/base.js").default} args.db - Database driver.
 * @param {string} args.tableName - Lookup table name.
 * @param {string} args.value - Lookup value.
 * @returns {Promise<number | string | null>} Lookup row id or null.
 */
async function findLookupId({ columnName, db, tableName, value }) {
    const rows = /** @type {Array<{id: number | string}>} */ (await db.query(`
    SELECT ${db.quoteColumn("id")} AS id
    FROM ${db.quoteTable(tableName)}
    WHERE ${db.quoteColumn(columnName)} = ${db.quote(value)}
  `));
    if (rows[0])
        return rows[0].id;
    return null;
}
/**
 * Normalizes an audit action string.
 * @param {string} action - Action name.
 * @returns {string} Trimmed, non-empty action name.
 */
function normalizeAction(action) {
    const normalizedAction = action.trim();
    if (!normalizedAction)
        throw new Error("Audit action must be present");
    return normalizedAction;
}
// ---------------------------------------------------------------------------
// Migration helpers
// ---------------------------------------------------------------------------
/**
 * Creates the shared audit tables migration up/down callbacks for use inside
 * a Migration class. The `table` parameter is a Migration instance.
 * @param {{id?: {type: string}}} [options] - ID column options.
 * @returns {{down: (table: import("../migration/index.js").default) => Promise<void>, up: (table: import("../migration/index.js").default) => Promise<void>}} - Up/down callbacks for the shared audit tables.
 */
function createSharedAuditTablesMigration(options = {}) {
    const opts = /** @type {{id?: {type: string}}} */ (options);
    const idOptions = /** @type {{type?: string}} */ (opts.id || {});
    const type = idOptions.type;
    return {
        async up(table) {
            await table.createTable("audit_actions", { id: /** @type {{type?: string}} */ (opts.id || {}) }, (/** @type {{string(name: string, options: Record<string, unknown>): void, timestamps(): void}} */ t) => {
                t.string("action", { index: { unique: true }, null: false });
                t.timestamps();
            });
            await table.createTable("audit_auditable_types", { id: /** @type {{type?: string}} */ (opts.id || {}) }, (/** @type {{string(name: string, options: Record<string, unknown>): void, timestamps(): void}} */ t) => {
                t.string("name", { index: { unique: true }, null: false });
                t.timestamps();
            });
            await table.createTable("audits", { id: /** @type {{type?: string}} */ (opts.id || {}) }, (/** @type {{json(name: string): void, references(name: string, options: Record<string, unknown>): void, timestamps(): void}} */ t) => {
                t.references("audit_action", { foreignKey: true, null: false, type });
                t.references("audit_auditable_type", { foreignKey: true, null: false, type });
                t.references("auditable", { null: false, polymorphic: true, type });
                t.json("audited_changes");
                t.json("params");
                t.timestamps();
            });
        },
        async down(table) {
            await table.dropTable("audits");
            await table.dropTable("audit_auditable_types");
            await table.dropTable("audit_actions");
        }
    };
}
/**
 * Returns the dedicated audit table name for a given model table name.
 * @param {string} modelTableName - Model table name (e.g. "projects").
 * @returns {string} Dedicated audit table name (e.g. "project_audits").
 */
function dedicatedAuditTableNameForTable(modelTableName) {
    if (modelTableName.endsWith("s")) {
        return `${modelTableName.slice(0, -1)}_audits`;
    }
    return `${modelTableName}_audits`;
}
export { AuditEvents, captureCreateAuditChanges, captureUpdateAuditChanges, createAudit, createCreateAudit, createDestroyAudit, createUpdateAudit, createSharedAuditTablesMigration, dedicatedAuditTableNameForTable, initializeAuditedModelRelationships, initializeAuditing, registerAuditCallback, registerAuditing, withoutAudit };
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXVkaXRpbmcuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcmVjb3JkL2F1ZGl0aW5nLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFDNUIsT0FBTyxLQUFLLFVBQVUsTUFBTSxZQUFZLENBQUE7QUFDeEMsT0FBTyxtQkFBbUIsTUFBTSw2QkFBNkIsQ0FBQTtBQUM3RCxPQUFPLEVBQUMscUJBQXFCLEVBQUUsMEJBQTBCLEVBQUMsTUFBTSxrQ0FBa0MsQ0FBQTtBQUVsRzs7Ozs7O0dBTUc7QUFDSDs7O0dBR0c7QUFFSDs7Ozs7Ozs7R0FRRztBQUVIOzs7R0FHRztBQUVIOzs7Ozs7R0FNRztBQUVIOzs7Ozs7OztHQVFHO0FBRUg7Ozs7Ozs7R0FPRztBQUVILHNGQUFzRjtBQUN0RixNQUFNLGtDQUFrQyxHQUFHLElBQUksT0FBTyxFQUFFLENBQUE7QUFFeEQsc0VBQXNFO0FBQ3RFLE1BQU0scUJBQXFCLEdBQUcsSUFBSSxPQUFPLEVBQUUsQ0FBQTtBQUUzQywrREFBK0Q7QUFDL0QsTUFBTSxlQUFlLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtBQUVqQyxNQUFNLDJCQUEyQixHQUFHLElBQUksT0FBTyxFQUFFLENBQUE7QUFFakQsMkVBQTJFO0FBQzNFLE1BQU0seUJBQXlCLEdBQUcsSUFBSSxPQUFPLEVBQUUsQ0FBQTtBQUUvQyw4RUFBOEU7QUFDOUUsd0RBQXdEO0FBQ3hELDhFQUE4RTtBQUU5RSx1RkFBdUY7QUFDdkYsSUFBSSxzQkFBc0IsR0FBRyxFQUFFLENBQUE7QUFFL0IsOEJBQThCO0FBQzlCLE1BQU0sV0FBVyxHQUFHO0lBQ2xCOzs7OztPQUtHO0lBQ0gsSUFBSSxDQUFDLElBQUksRUFBRSxNQUFNLEVBQUUsSUFBSTtRQUNyQixNQUFNLE9BQU8sR0FBRyxzQkFBc0IsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUE7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QUFDLFVBQVUsRUFBRSxDQUFBO1lBQ2hCLENBQUMsQ0FBQyxDQUFBO1FBQ0osQ0FBQztRQUVELEtBQUssQ0FBQyxJQUFJLENBQUMsS0FBSztZQUNkLE1BQU0sS0FBSyxDQUFDLFNBQVMsQ0FBQyxRQUFRLENBQUMsQ0FBQTtZQUMvQixNQUFNLEtBQUssQ0FBQyxTQUFTLENBQUMsdUJBQXVCLENBQUMsQ0FBQTtZQUM5QyxNQUFNLEtBQUssQ0FBQyxTQUFTLENBQUMsZUFBZSxDQUFDLENBQUE7UUFDeEMsQ0FBQztLQUNGLENBQUE7QUFDSCxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsK0JBQStCLENBQUMsY0FBYztJQUNyRCxJQUFJLGNBQWMsQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUNqQyxPQUFPLEdBQUcsY0FBYyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFBO0lBQ2hELENBQUM7SUFFRCxPQUFPLEdBQUcsY0FBYyxTQUFTLENBQUE7QUFDbkMsQ0FBQztBQUVELE9BQU8sRUFDTCxXQUFXLEVBQ1gseUJBQXlCLEVBQ3pCLHlCQUF5QixFQUN6QixXQUFXLEVBQ1gsaUJBQWlCLEVBQ2pCLGtCQUFrQixFQUNsQixpQkFBaUIsRUFDakIsZ0NBQWdDLEVBQ2hDLCtCQUErQixFQUMvQixtQ0FBbUMsRUFDbkMsa0JBQWtCLEVBQ2xCLHFCQUFxQixFQUNyQixnQkFBZ0IsRUFDaEIsWUFBWSxFQUNiLENBQUEiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IFVVSUQgZnJvbSBcInB1cmUtdXVpZFwiXG5pbXBvcnQgKiBhcyBpbmZsZWN0aW9uIGZyb20gXCJpbmZsZWN0aW9uXCJcbmltcG9ydCBIYXNNYW55UmVsYXRpb25zaGlwIGZyb20gXCIuL3JlbGF0aW9uc2hpcHMvaGFzLW1hbnkuanNcIlxuaW1wb3J0IHtzY2FsYXJNb2RlbFByaW1hcnlLZXksIHNjYWxhck1vZGVsUHJpbWFyeUtleVZhbHVlfSBmcm9tIFwiLi4vLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIlxuXG4vKipcbiAqIEdsb2JhbCBhdWRpdCBldmVudCBidXMgbWF0Y2hpbmcgQWN0aXZlUmVjb3JkQXVkaXRhYmxlOjpFdmVudHMuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBBdWRpdEV2ZW50c1R5cGVcbiAqIEBwcm9wZXJ0eSB7KHR5cGU6IHN0cmluZywgYWN0aW9uOiBzdHJpbmcsIGFyZ3M6IEF1ZGl0RXZlbnRQYXlsb2FkKSA9PiB2b2lkfSBjYWxsIC0gRmlyZSBhbGwgY2FsbGJhY2tzIGZvciBhIG1vZGVsIHR5cGUgKyBhY3Rpb24uXG4gKiBAcHJvcGVydHkgeyh0eXBlOiBzdHJpbmcsIGFjdGlvbjogc3RyaW5nLCBjYWxsYmFjazogKGFyZ3M6IEF1ZGl0RXZlbnRQYXlsb2FkKSA9PiB2b2lkKSA9PiAoKSA9PiB2b2lkfSBjb25uZWN0IC0gUmVnaXN0ZXIgYSBjYWxsYmFjayBmb3IgYSBtb2RlbCB0eXBlICsgYWN0aW9uLiBSZXR1cm5zIGFuIHVuc3Vic2NyaWJlIGZ1bmN0aW9uLlxuICogQHByb3BlcnR5IHsoKSA9PiB2b2lkfSByZXNldCAtIENsZWFyIGFsbCByZWdpc3RlcmVkIGNhbGxiYWNrcy5cbiAqL1xuLyoqXG4gKiBBdWRpdENoYW5nZXMgdHlwZS5cbiAqIEB0eXBlZGVmIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IEF1ZGl0Q2hhbmdlc1xuICovXG5cbi8qKlxuICogQXVkaXRFdmVudFBheWxvYWQgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEF1ZGl0RXZlbnRQYXlsb2FkXG4gKiBAcHJvcGVydHkge3N0cmluZ30gYWN0aW9uIC0gQXVkaXQgYWN0aW9uIG5hbWUuXG4gKiBAcHJvcGVydHkge251bWJlciB8IHN0cmluZ30gYXVkaXRJZCAtIENyZWF0ZWQgYXVkaXQgcm93IGlkLlxuICogQHByb3BlcnR5IHtBdWRpdENoYW5nZXMgfCBudWxsfSBhdWRpdGVkQ2hhbmdlcyAtIENoYW5nZXMgY2FwdHVyZWQgZm9yIHRoZSBhdWRpdC5cbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbH0gcGFyYW1zIC0gT3B0aW9uYWwgY2FsbGVyLXN1cHBsaWVkIGF1ZGl0IHBhcmFtcy5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSByZWNvcmQgLSBBdWRpdGVkIHJlY29yZC5cbiAqL1xuXG4vKipcbiAqIEF1ZGl0Q2FsbGJhY2sgdHlwZS5cbiAqIEB0eXBlZGVmIHsocGF5bG9hZDogQXVkaXRFdmVudFBheWxvYWQpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+fSBBdWRpdENhbGxiYWNrXG4gKi9cblxuLyoqXG4gKiBDcmVhdGVBdWRpdEFyZ3MgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IENyZWF0ZUF1ZGl0QXJnc1xuICogQHByb3BlcnR5IHtzdHJpbmd9IGFjdGlvbiAtIEF1ZGl0IGFjdGlvbiBuYW1lLlxuICogQHByb3BlcnR5IHtBdWRpdENoYW5nZXMgfCBudWxsfSBbYXVkaXRlZENoYW5nZXNdIC0gRXhwbGljaXQgY2hhbmdlcyB0byBwZXJzaXN0LlxuICogQHByb3BlcnR5IHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsfSBbcGFyYW1zXSAtIE9wdGlvbmFsIG1ldGFkYXRhIHRvIHN0b3JlIHdpdGggdGhlIGF1ZGl0LlxuICovXG5cbi8qKlxuICogQXVkaXRlZE1vZGVsQ2xhc3MgdHlwZS5cbiAqIEB0eXBlZGVmIHt0eXBlb2YgaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0ICYge1xuICogICBfYXVkaXRDYWxsYmFja3M/OiBSZWNvcmQ8c3RyaW5nLCBBdWRpdENhbGxiYWNrW10+LFxuICogICBfYXVkaXRMaWZlY3ljbGVDYWxsYmFja3NSZWdpc3RlcmVkPzogYm9vbGVhbixcbiAqICAgX2F1ZGl0VGFibGVSZXNvbHZlZD86IGJvb2xlYW4sXG4gKiAgIF9hdWRpdFRhYmxlRGF0YT86IEF1ZGl0VGFibGVEYXRhXG4gKiB9fSBBdWRpdGVkTW9kZWxDbGFzc1xuICovXG5cbi8qKlxuICogQXVkaXRUYWJsZURhdGEgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEF1ZGl0VGFibGVEYXRhXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IGRlZGljYXRlZCAtIFdoZXRoZXIgYSBkZWRpY2F0ZWQgYXVkaXQgdGFibGUgZXhpc3RzLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHRhYmxlTmFtZSAtIE5hbWUgb2YgdGhlIGF1ZGl0IHRhYmxlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGZvcmVpZ25LZXkgLSBDb2x1bW4gbmFtZSB0aGF0IHJlZmVyZW5jZXMgdGhlIGF1ZGl0ZWQgbW9kZWwuXG4gKiBAcHJvcGVydHkge3R5cGVvZiBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IGF1ZGl0Q2xhc3MgLSBUaGUgYXVkaXQgbW9kZWwgY2xhc3MgdG8gdXNlLlxuICovXG5cbi8qKiBAdHlwZSB7V2Vha01hcDxpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQsIE1hcDxzdHJpbmcsIGJvb2xlYW4+Pn0gKi9cbmNvbnN0IGRlZGljYXRlZFRhYmxlQ2FjaGVCeUNvbmZpZ3VyYXRpb24gPSBuZXcgV2Vha01hcCgpXG5cbi8qKiBAdHlwZSB7V2Vha01hcDxBdWRpdGVkTW9kZWxDbGFzcywgTWFwPHN0cmluZywgQXVkaXRUYWJsZURhdGE+Pn0gKi9cbmNvbnN0IGF1ZGl0VGFibGVEYXRhQnlNb2RlbCA9IG5ldyBXZWFrTWFwKClcblxuLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCB0eXBlb2YgaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gKi9cbmNvbnN0IGF1ZGl0Q2xhc3NDYWNoZSA9IG5ldyBNYXAoKVxuXG5jb25zdCBnZW5lcmF0ZWRBdWRpdFJlbGF0aW9uc2hpcHMgPSBuZXcgV2Vha1NldCgpXG5cbi8qKiBAdHlwZSB7V2Vha01hcDxBdWRpdGVkTW9kZWxDbGFzcywgTWFwPHN0cmluZywgSGFzTWFueVJlbGF0aW9uc2hpcD4+fSAqL1xuY29uc3QgYXVkaXRSZWxhdGlvbnNoaXBzQnlNb2RlbCA9IG5ldyBXZWFrTWFwKClcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBHbG9iYWwgZXZlbnQgYnVzIChsaWtlIEFjdGl2ZVJlY29yZEF1ZGl0YWJsZTo6RXZlbnRzKVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmVjb3JkPHN0cmluZywgQXJyYXk8KGFyZ3M6IEF1ZGl0RXZlbnRQYXlsb2FkKSA9PiB2b2lkPj4+fSAqL1xubGV0IGdsb2JhbEV2ZW50Q29ubmVjdGlvbnMgPSB7fVxuXG4vKiogQHR5cGUge0F1ZGl0RXZlbnRzVHlwZX0gKi9cbmNvbnN0IEF1ZGl0RXZlbnRzID0ge1xuICAvKipcbiAgICogRmlyZSBhbGwgcmVnaXN0ZXJlZCBjYWxsYmFja3MgZm9yIGEgbW9kZWwgdHlwZSBhbmQgYWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdHlwZSAtIEF1ZGl0ZWQgbW9kZWwgdHlwZSB3aG9zZSBsaXN0ZW5lcnMgc2hvdWxkIGZpcmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhY3Rpb24gLSBBdWRpdCBhY3Rpb24gd2hvc2UgbGlzdGVuZXJzIHNob3VsZCBmaXJlLlxuICAgKiBAcGFyYW0ge0F1ZGl0RXZlbnRQYXlsb2FkfSBhcmdzIC0gQXVkaXQgZXZlbnQgZGVsaXZlcmVkIHRvIG1hdGNoaW5nIGxpc3RlbmVycy5cbiAgICovXG4gIGNhbGwodHlwZSwgYWN0aW9uLCBhcmdzKSB7XG4gICAgY29uc3QgYWN0aW9ucyA9IGdsb2JhbEV2ZW50Q29ubmVjdGlvbnNbdHlwZV0gfHwge31cbiAgICBjb25zdCBjYWxsYmFja3MgPSBhY3Rpb25zW2FjdGlvbl0gfHwgW11cblxuICAgIGZvciAoY29uc3QgY2FsbGJhY2sgb2YgWy4uLmNhbGxiYWNrc10pIHtcbiAgICAgIGNhbGxiYWNrKGFyZ3MpXG4gICAgfVxuICB9LFxuXG4gIC8qKlxuICAgKiBSZWdpc3RlciBhIGNhbGxiYWNrIGZvciBhIG1vZGVsIHR5cGUgYW5kIGFjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHR5cGUgLSBBdWRpdGVkIG1vZGVsIHR5cGUgdG8gb2JzZXJ2ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFjdGlvbiAtIEF1ZGl0IGFjdGlvbiB0byBvYnNlcnZlLlxuICAgKiBAcGFyYW0geyhhcmdzOiBBdWRpdEV2ZW50UGF5bG9hZCkgPT4gdm9pZH0gY2FsbGJhY2sgLSBMaXN0ZW5lciBpbnZva2VkIGZvciBtYXRjaGluZyBhdWRpdCBldmVudHMuXG4gICAqIEByZXR1cm5zIHsoKSA9PiB2b2lkfSAtIENhbGxiYWNrIHRoYXQgcmVtb3ZlcyB0aGUgcmVnaXN0cmF0aW9uLlxuICAgKi9cbiAgY29ubmVjdCh0eXBlLCBhY3Rpb24sIGNhbGxiYWNrKSB7XG4gICAgaWYgKCFnbG9iYWxFdmVudENvbm5lY3Rpb25zW3R5cGVdKSB7XG4gICAgICBnbG9iYWxFdmVudENvbm5lY3Rpb25zW3R5cGVdID0ge31cbiAgICB9XG5cbiAgICBpZiAoIWdsb2JhbEV2ZW50Q29ubmVjdGlvbnNbdHlwZV1bYWN0aW9uXSkge1xuICAgICAgZ2xvYmFsRXZlbnRDb25uZWN0aW9uc1t0eXBlXVthY3Rpb25dID0gW11cbiAgICB9XG5cbiAgICBnbG9iYWxFdmVudENvbm5lY3Rpb25zW3R5cGVdW2FjdGlvbl0ucHVzaChjYWxsYmFjaylcblxuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICBjb25zdCBsaXN0ID0gZ2xvYmFsRXZlbnRDb25uZWN0aW9uc1t0eXBlXT8uW2FjdGlvbl1cblxuICAgICAgaWYgKGxpc3QpIHtcbiAgICAgICAgY29uc3QgaW5kZXggPSBsaXN0LmluZGV4T2YoY2FsbGJhY2spXG5cbiAgICAgICAgaWYgKGluZGV4ID49IDApIHtcbiAgICAgICAgICBsaXN0LnNwbGljZShpbmRleCwgMSlcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfSxcblxuICAvKiogQ2xlYXIgYWxsIHJlZ2lzdGVyZWQgY2FsbGJhY2tzLiAqL1xuICByZXNldCgpIHtcbiAgICBnbG9iYWxFdmVudENvbm5lY3Rpb25zID0ge31cbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRhYmxlIGRldGVjdGlvblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogUmV0dXJucyB0aGUgZGVkaWNhdGVkIGF1ZGl0IHRhYmxlIG5hbWUgZm9yIGEgbW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge0F1ZGl0ZWRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gQXVkaXRlZCBtb2RlbCBjbGFzcy5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IGUuZy4gXCJwcm9qZWN0X2F1ZGl0c1wiIGZvciBhIFwicHJvamVjdHNcIiB0YWJsZS5cbiAqL1xuZnVuY3Rpb24gZGVkaWNhdGVkQXVkaXRUYWJsZU5hbWUobW9kZWxDbGFzcykge1xuICBjb25zdCB0YWJsZSA9IG1vZGVsQ2xhc3MudGFibGVOYW1lKClcblxuICBpZiAodGFibGUuZW5kc1dpdGgoXCJzXCIpKSB7XG4gICAgcmV0dXJuIGAke3RhYmxlLnNsaWNlKDAsIC0xKX1fYXVkaXRzYFxuICB9XG5cbiAgcmV0dXJuIGAke3RhYmxlfV9hdWRpdHNgXG59XG5cbi8qKlxuICogUmVzb2x2ZXMgYXVkaXQgdGFibGUgZGF0YSBmb3IgYSBtb2RlbCBjbGFzcy4gQ2FjaGVkIHBlciBtb2RlbC5cbiAqIENhbGxlZCBsYXppbHkgb24gZmlyc3QgY3JlYXRlQXVkaXQgLyB3aXRob3V0QXVkaXQgLyByZWxhdGlvbnNoaXAgdXNhZ2UuXG4gKiBAcGFyYW0ge0F1ZGl0ZWRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gQXVkaXRlZCBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IFtjb25uZWN0aW9uXSAtIEV4cGxpY2l0IHJlY29yZC1vd25lZCBjb25uZWN0aW9uLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9vcGVyYXRpb24uanNcIikuZGVmYXVsdH0gW29wZXJhdGlvbl0gLSBFeHBsaWNpdCByZWNvcmQgb3BlcmF0aW9uLlxuICogQHJldHVybnMge1Byb21pc2U8QXVkaXRUYWJsZURhdGE+fSBSZXNvbHZlZCBhdWRpdCB0YWJsZSBtZXRhZGF0YS5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZUF1ZGl0VGFibGVEYXRhKG1vZGVsQ2xhc3MsIGNvbm5lY3Rpb24sIG9wZXJhdGlvbikge1xuICBjb25zdCByZXNvbHZlZENvbm5lY3Rpb24gPSBjb25uZWN0aW9uIHx8IG1vZGVsQ2xhc3MuY29ubmVjdGlvbigpXG4gIGNvbnN0IGRhdGFiYXNlSWRlbnRpdHkgPSBhdWRpdERhdGFiYXNlSWRlbnRpdHkobW9kZWxDbGFzcywgcmVzb2x2ZWRDb25uZWN0aW9uLCBvcGVyYXRpb24pXG4gIGxldCB0YWJsZURhdGFCeUlkZW50aXR5ID0gYXVkaXRUYWJsZURhdGFCeU1vZGVsLmdldChtb2RlbENsYXNzKVxuXG4gIGlmICghdGFibGVEYXRhQnlJZGVudGl0eSkge1xuICAgIHRhYmxlRGF0YUJ5SWRlbnRpdHkgPSBuZXcgTWFwKClcbiAgICBhdWRpdFRhYmxlRGF0YUJ5TW9kZWwuc2V0KG1vZGVsQ2xhc3MsIHRhYmxlRGF0YUJ5SWRlbnRpdHkpXG4gIH1cblxuICBjb25zdCBjYWNoZWRUYWJsZURhdGEgPSB0YWJsZURhdGFCeUlkZW50aXR5LmdldChkYXRhYmFzZUlkZW50aXR5KVxuXG4gIGlmIChjYWNoZWRUYWJsZURhdGEpIHtcbiAgICByZWdpc3RlckF1ZGl0UmVsYXRpb25zaGlwKG1vZGVsQ2xhc3MsIGNhY2hlZFRhYmxlRGF0YSwgZGF0YWJhc2VJZGVudGl0eSlcbiAgICByZXR1cm4gY2FjaGVkVGFibGVEYXRhXG4gIH1cblxuICBjb25zdCB0YWJsZURhdGEgPSBhd2FpdCBidWlsZEF1ZGl0VGFibGVEYXRhKG1vZGVsQ2xhc3MsIHJlc29sdmVkQ29ubmVjdGlvbiwgZGF0YWJhc2VJZGVudGl0eSlcbiAgY29uc3QgY29uZmlndXJhdGlvbiA9IG1vZGVsQ2xhc3MuX2dldENvbmZpZ3VyYXRpb24oKVxuXG4gIHRhYmxlRGF0YS5hdWRpdENsYXNzLnJlZ2lzdGVyUmVjb3JkQ2xhc3Moe2NvbmZpZ3VyYXRpb259KVxuICBhd2FpdCB0YWJsZURhdGEuYXVkaXRDbGFzcy5pbml0aWFsaXplUmVjb3JkKHtjb25maWd1cmF0aW9uLCBjb25uZWN0aW9uOiByZXNvbHZlZENvbm5lY3Rpb259KVxuXG4gIG1vZGVsQ2xhc3MuX2F1ZGl0VGFibGVEYXRhID0gdGFibGVEYXRhXG4gIG1vZGVsQ2xhc3MuX2F1ZGl0VGFibGVSZXNvbHZlZCA9IHRydWVcbiAgdGFibGVEYXRhQnlJZGVudGl0eS5zZXQoZGF0YWJhc2VJZGVudGl0eSwgdGFibGVEYXRhKVxuXG4gIHJlZ2lzdGVyQXVkaXRSZWxhdGlvbnNoaXAobW9kZWxDbGFzcywgdGFibGVEYXRhLCBkYXRhYmFzZUlkZW50aXR5KVxuXG4gIHJldHVybiB0YWJsZURhdGFcbn1cblxuLyoqXG4gKiBCdWlsZHMgYXVkaXQgdGFibGUgbWV0YWRhdGEgZm9yIGEgbW9kZWwgY2xhc3MuIFByZWZlcnMgdGhlIGNvbnN1bWVyJ3NcbiAqIHJlZ2lzdGVyZWQgQXVkaXQgbW9kZWwgZm9yIHNoYXJlZCB0YWJsZXM7IGZhbGxzIGJhY2sgdG8gYSBmcmFtZXdvcmstb3duZWRcbiAqIGR5bmFtaWMgY2xhc3MuXG4gKiBAcGFyYW0ge0F1ZGl0ZWRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gQXVkaXRlZCBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBFeHBsaWNpdCByZWNvcmQtb3duZWQgY29ubmVjdGlvbi5cbiAqIEBwYXJhbSB7c3RyaW5nfSBkYXRhYmFzZUlkZW50aXR5IC0gQ2FwdHVyZWQgcGh5c2ljYWwgZGF0YWJhc2UgaWRlbnRpdHkuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxBdWRpdFRhYmxlRGF0YT59IEF1ZGl0IHRhYmxlIG1ldGFkYXRhLlxuICovXG5hc3luYyBmdW5jdGlvbiBidWlsZEF1ZGl0VGFibGVEYXRhKG1vZGVsQ2xhc3MsIGNvbm5lY3Rpb24sIGRhdGFiYXNlSWRlbnRpdHkpIHtcbiAgY29uc3QgZGVkaWNhdGVkVGFibGUgPSBkZWRpY2F0ZWRBdWRpdFRhYmxlTmFtZShtb2RlbENsYXNzKVxuICBjb25zdCBkZWRpY2F0ZWRFeGlzdHMgPSBhd2FpdCBkZWRpY2F0ZWRUYWJsZUV4aXN0c0ZvckNvbm5lY3Rpb24obW9kZWxDbGFzcywgZGVkaWNhdGVkVGFibGUsIGNvbm5lY3Rpb24sIGRhdGFiYXNlSWRlbnRpdHkpXG5cbiAgaWYgKGRlZGljYXRlZEV4aXN0cykge1xuICAgIGNvbnN0IGF1ZGl0Q2xhc3MgPSBkZWRpY2F0ZWRBdWRpdENsYXNzKG1vZGVsQ2xhc3MsIGRlZGljYXRlZFRhYmxlKVxuICAgIGNvbnN0IGZvcmVpZ25LZXkgPSBtb2RlbEZvcmVpZ25LZXkobW9kZWxDbGFzcylcblxuICAgIHJldHVybiB7XG4gICAgICBhdWRpdENsYXNzLFxuICAgICAgZGVkaWNhdGVkOiB0cnVlLFxuICAgICAgZm9yZWlnbktleSxcbiAgICAgIHRhYmxlTmFtZTogZGVkaWNhdGVkVGFibGVcbiAgICB9XG4gIH1cblxuICBjb25zdCBjb25maWd1cmF0aW9uID0gbW9kZWxDbGFzcy5fZ2V0Q29uZmlndXJhdGlvbigpXG5cbiAgY29uc3QgY29uc3VtZXJBdWRpdENsYXNzID0gY29uZmlndXJhdGlvbi5nZXRNb2RlbENsYXNzZXMoKS5BdWRpdFxuXG4gIGlmIChjb25zdW1lckF1ZGl0Q2xhc3MpIHtcbiAgICByZXR1cm4ge1xuICAgICAgYXVkaXRDbGFzczogY29uc3VtZXJBdWRpdENsYXNzLFxuICAgICAgZGVkaWNhdGVkOiBmYWxzZSxcbiAgICAgIGZvcmVpZ25LZXk6IFwiYXVkaXRhYmxlX2lkXCIsXG4gICAgICB0YWJsZU5hbWU6IFwiYXVkaXRzXCJcbiAgICB9XG4gIH1cblxuICByZXR1cm4ge1xuICAgIGF1ZGl0Q2xhc3M6IGNhY2hlZFNoYXJlZEF1ZGl0Q2xhc3MobW9kZWxDbGFzcyksXG4gICAgZGVkaWNhdGVkOiBmYWxzZSxcbiAgICBmb3JlaWduS2V5OiBcImF1ZGl0YWJsZV9pZFwiLFxuICAgIHRhYmxlTmFtZTogXCJhdWRpdHNcIlxuICB9XG59XG5cbi8qKlxuICogQ2hlY2tzIHdoZXRoZXIgYSBkZWRpY2F0ZWQgYXVkaXQgdGFibGUgZXhpc3RzIGZvciBhIG1vZGVsJ3MgY29ubmVjdGlvbi5cbiAqIEBwYXJhbSB7QXVkaXRlZE1vZGVsQ2xhc3N9IG1vZGVsQ2xhc3MgLSBBdWRpdGVkIG1vZGVsIGNsYXNzIG93bmluZyB0aGUgQ29uZmlndXJhdGlvbi5cbiAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBEZWRpY2F0ZWQgYXVkaXQgdGFibGUgbmFtZSB0byBjaGVjay5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBFeHBsaWNpdCByZWNvcmQtb3duZWQgY29ubmVjdGlvbi5cbiAqIEBwYXJhbSB7c3RyaW5nfSBkYXRhYmFzZUlkZW50aXR5IC0gQ2FwdHVyZWQgcGh5c2ljYWwgZGF0YWJhc2UgaWRlbnRpdHkuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gV2hldGhlciB0aGUgdGFibGUgZXhpc3RzLlxuICovXG5hc3luYyBmdW5jdGlvbiBkZWRpY2F0ZWRUYWJsZUV4aXN0c0ZvckNvbm5lY3Rpb24obW9kZWxDbGFzcywgdGFibGVOYW1lLCBjb25uZWN0aW9uLCBkYXRhYmFzZUlkZW50aXR5KSB7XG4gIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSBtb2RlbENsYXNzLl9nZXRDb25maWd1cmF0aW9uKClcbiAgY29uc3QgY2FjaGVLZXkgPSBgJHtkYXRhYmFzZUlkZW50aXR5fToke3RhYmxlTmFtZX1gXG4gIGxldCBkZWRpY2F0ZWRUYWJsZUNhY2hlID0gZGVkaWNhdGVkVGFibGVDYWNoZUJ5Q29uZmlndXJhdGlvbi5nZXQoY29uZmlndXJhdGlvbilcblxuICBpZiAoIWRlZGljYXRlZFRhYmxlQ2FjaGUpIHtcbiAgICBkZWRpY2F0ZWRUYWJsZUNhY2hlID0gbmV3IE1hcCgpXG4gICAgZGVkaWNhdGVkVGFibGVDYWNoZUJ5Q29uZmlndXJhdGlvbi5zZXQoY29uZmlndXJhdGlvbiwgZGVkaWNhdGVkVGFibGVDYWNoZSlcbiAgfVxuXG4gIGNvbnN0IGNhY2hlZCA9IGRlZGljYXRlZFRhYmxlQ2FjaGUuZ2V0KGNhY2hlS2V5KVxuXG4gIGlmICh0eXBlb2YgY2FjaGVkID09PSBcImJvb2xlYW5cIikge1xuICAgIHJldHVybiBjYWNoZWRcbiAgfVxuXG4gIGNvbnN0IHRhYmxlID0gYXdhaXQgY29ubmVjdGlvbi5nZXRUYWJsZUJ5TmFtZSh0YWJsZU5hbWUsIHt0aHJvd0Vycm9yOiBmYWxzZX0pXG4gIGNvbnN0IGV4aXN0cyA9IEJvb2xlYW4odGFibGUpXG5cbiAgZGVkaWNhdGVkVGFibGVDYWNoZS5zZXQoY2FjaGVLZXksIGV4aXN0cylcblxuICByZXR1cm4gZXhpc3RzXG59XG5cbi8qKlxuICogUmVzb2x2ZXMgYSBjYWNoZSBpZGVudGl0eSBmcm9tIGV4cGxpY2l0IG9wZXJhdGlvbiBvd25lcnNoaXAgb3IgdGhlIGFjdHVhbFxuICogc3RhbXBlZCBwb29sIGNvbm5lY3Rpb24uIEFtYmllbnQgdGVuYW50IHN0YXRlIGlzIG5ldmVyIHVzZWQgd2hlbiBhblxuICogb3BlcmF0aW9uIGlzIGF2YWlsYWJsZS5cbiAqIEBwYXJhbSB7QXVkaXRlZE1vZGVsQ2xhc3N9IG1vZGVsQ2xhc3MgLSBBdWRpdGVkIG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gY29ubmVjdGlvbiAtIEFjdHVhbCBjb25uZWN0aW9uLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9vcGVyYXRpb24uanNcIikuZGVmYXVsdH0gW29wZXJhdGlvbl0gLSBFeHBsaWNpdCBvcGVyYXRpb24uXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFBoeXNpY2FsIGRhdGFiYXNlIGlkZW50aXR5LlxuICovXG5mdW5jdGlvbiBhdWRpdERhdGFiYXNlSWRlbnRpdHkobW9kZWxDbGFzcywgY29ubmVjdGlvbiwgb3BlcmF0aW9uKSB7XG4gIGlmIChvcGVyYXRpb24pIHJldHVybiBvcGVyYXRpb24uZGF0YWJhc2VJZGVudGl0eSgpXG5cbiAgY29uc3QgZGF0YWJhc2VJZGVudGlmaWVyID0gbW9kZWxDbGFzcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKVxuICBjb25zdCBwb29sID0gbW9kZWxDbGFzcy5fZ2V0Q29uZmlndXJhdGlvbigpLmdldERhdGFiYXNlUG9vbChkYXRhYmFzZUlkZW50aWZpZXIpXG5cbiAgcmV0dXJuIGAke2RhdGFiYXNlSWRlbnRpZmllcn06JHtwb29sLmdldENvbm5lY3Rpb25Db25maWd1cmF0aW9uUmV1c2VLZXkoY29ubmVjdGlvbil9YFxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIER5bmFtaWMgYXVkaXQgY2xhc3Nlc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogUmV0dXJucyBhIGZyYW1ld29yay1vd25lZCBzaGFyZWQgQXVkaXQgY2xhc3MgZm9yIHRoZSBgYXVkaXRzYCB0YWJsZS5cbiAqIFRoaXMgaXMgb25seSB1c2VkIHdoZW4gbm8gY29uc3VtZXItcmVnaXN0ZXJlZCBBdWRpdCBtb2RlbCBleGlzdHMuXG4gKiBAcGFyYW0ge0F1ZGl0ZWRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gQW55IGF1ZGl0ZWQgbW9kZWwgY2xhc3MgKHVzZWQgdG8gbG9jYXRlIERhdGFiYXNlUmVjb3JkKS5cbiAqIEByZXR1cm5zIHt0eXBlb2YgaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBTaGFyZWQgQXVkaXQgbW9kZWwgY2xhc3MuXG4gKi9cbmZ1bmN0aW9uIHNoYXJlZEF1ZGl0Q2xhc3MobW9kZWxDbGFzcykge1xuICBjb25zdCBkYlJlY29yZENsYXNzID0gZmluZERhdGFiYXNlUmVjb3JkQ2xhc3MobW9kZWxDbGFzcylcblxuICAvKipcbiAgICogRnJhbWV3b3JrLW93bmVkIEF1ZGl0IG1vZGVsIGZvciB0aGUgc2hhcmVkIGBhdWRpdHNgIHRhYmxlLlxuICAgKi9cbiAgY2xhc3MgQXVkaXQgZXh0ZW5kcyBkYlJlY29yZENsYXNzIHtcbiAgICAvKipcbiAgICAgKiBSZXR1cm5zIHRoZSBiYWNraW5nIHRhYmxlIG5hbWUuXG4gICAgICogQHJldHVybnMge3N0cmluZ30gLSBTaGFyZWQgYGF1ZGl0c2AgdGFibGUgbmFtZS5cbiAgICAgKi9cbiAgICBzdGF0aWMgdGFibGVOYW1lKCkge1xuICAgICAgcmV0dXJuIFwiYXVkaXRzXCJcbiAgICB9XG4gIH1cblxuICBPYmplY3QuZGVmaW5lUHJvcGVydHkoQXVkaXQsIFwibW9kZWxOYW1lXCIsIHt2YWx1ZTogXCJBdWRpdFwiLCB3cml0YWJsZTogZmFsc2V9KVxuICBhcHBseUF1ZGl0Q2xhc3NEYXRhYmFzZVJvdXRpbmcobW9kZWxDbGFzcywgQXVkaXQpXG5cbiAgcmV0dXJuIC8qKiBAdHlwZSB7dHlwZW9mIGltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gKi8gKEF1ZGl0KVxufVxuXG4vKipcbiAqIFJldHVybnMgdGhlIGNhY2hlZCBmcmFtZXdvcmstb3duZWQgc2hhcmVkIEF1ZGl0IGNsYXNzIGZvciBhIGRhdGFiYXNlLlxuICogQHBhcmFtIHtBdWRpdGVkTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIEFueSBhdWRpdGVkIG1vZGVsIGNsYXNzLlxuICogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IFNoYXJlZCBBdWRpdCBtb2RlbCBjbGFzcy5cbiAqL1xuZnVuY3Rpb24gY2FjaGVkU2hhcmVkQXVkaXRDbGFzcyhtb2RlbENsYXNzKSB7XG4gIGNvbnN0IHJvdXRpbmdLZXkgPSBtb2RlbENsYXNzLmhhc1RlbmFudERhdGFiYXNlSWRlbnRpZmllclJlc29sdmVyKClcbiAgICA/IGB0ZW5hbnQ6JHttb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpfWBcbiAgICA6IGBkYXRhYmFzZToke21vZGVsQ2xhc3MuZ2V0Q29uZmlndXJlZERhdGFiYXNlSWRlbnRpZmllcigpfWBcbiAgY29uc3QgY2FjaGVLZXkgPSBgc2hhcmVkOiR7cm91dGluZ0tleX1gXG4gIGxldCBhdWRpdENsYXNzID0gYXVkaXRDbGFzc0NhY2hlLmdldChjYWNoZUtleSlcblxuICBpZiAoIWF1ZGl0Q2xhc3MpIHtcbiAgICBhdWRpdENsYXNzID0gc2hhcmVkQXVkaXRDbGFzcyhtb2RlbENsYXNzKVxuICAgIGF1ZGl0Q2xhc3NDYWNoZS5zZXQoY2FjaGVLZXksIGF1ZGl0Q2xhc3MpXG4gIH1cblxuICByZXR1cm4gYXVkaXRDbGFzc1xufVxuXG4vKipcbiAqIFJldHVybnMgYSBkeW5hbWljIHBlci1tb2RlbCBhdWRpdCBjbGFzcyBmb3IgYSBkZWRpY2F0ZWQgdGFibGUuXG4gKiBAcGFyYW0ge0F1ZGl0ZWRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gQXVkaXRlZCBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBEZWRpY2F0ZWQgYXVkaXQgdGFibGUgbmFtZSAoZS5nLiBcInByb2plY3RfYXVkaXRzXCIpLlxuICogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IERlZGljYXRlZCBhdWRpdCBtb2RlbCBjbGFzcy5cbiAqL1xuZnVuY3Rpb24gZGVkaWNhdGVkQXVkaXRDbGFzcyhtb2RlbENsYXNzLCB0YWJsZU5hbWUpIHtcbiAgY29uc3QgZGJSZWNvcmRDbGFzcyA9IGZpbmREYXRhYmFzZVJlY29yZENsYXNzKG1vZGVsQ2xhc3MpXG4gIGNvbnN0IG1vZGVsTmFtZSA9IG1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKClcbiAgY29uc3QgbW9kZWxLZXkgPSBtb2RlbFBhcmFtS2V5KG1vZGVsQ2xhc3MpXG5cbiAgLyoqXG4gICAqIEZyYW1ld29yay1vd25lZCBwZXItbW9kZWwgQXVkaXQgY2xhc3MuXG4gICAqL1xuICBjbGFzcyBNb2RlbEF1ZGl0IGV4dGVuZHMgZGJSZWNvcmRDbGFzcyB7XG4gICAgLyoqXG4gICAgICogUmV0dXJucyB0aGUgYmFja2luZyB0YWJsZSBuYW1lLlxuICAgICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRGVkaWNhdGVkIGF1ZGl0IHRhYmxlIHN1cHBsaWVkIGZvciB0aGlzIG1vZGVsIGNsYXNzLlxuICAgICAqL1xuICAgIHN0YXRpYyB0YWJsZU5hbWUoKSB7XG4gICAgICByZXR1cm4gdGFibGVOYW1lXG4gICAgfVxuICB9XG5cbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5KE1vZGVsQXVkaXQsIFwibW9kZWxOYW1lXCIsIHt2YWx1ZTogYCR7bW9kZWxOYW1lfUF1ZGl0YCwgd3JpdGFibGU6IGZhbHNlfSlcbiAgYXBwbHlBdWRpdENsYXNzRGF0YWJhc2VSb3V0aW5nKG1vZGVsQ2xhc3MsIE1vZGVsQXVkaXQpXG4gIE1vZGVsQXVkaXQuYmVsb25nc1RvKG1vZGVsS2V5LCB7Y2xhc3NOYW1lOiBtb2RlbE5hbWV9KVxuXG4gIHJldHVybiAvKiogQHR5cGUge3R5cGVvZiBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9ICovIChNb2RlbEF1ZGl0KVxufVxuXG4vKipcbiAqIE1ha2VzIGZyYW1ld29yay1vd25lZCBhdWRpdCBjbGFzc2VzIHJlYWQgdGhlIHNhbWUgZGF0YWJhc2UgYXMgdGhlIGF1ZGl0ZWQgbW9kZWwuXG4gKiBAcGFyYW0ge0F1ZGl0ZWRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gQXVkaXRlZCBzb3VyY2UgbW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IGF1ZGl0Q2xhc3MgLSBHZW5lcmF0ZWQgYXVkaXQgY2xhc3MuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gYXBwbHlBdWRpdENsYXNzRGF0YWJhc2VSb3V0aW5nKG1vZGVsQ2xhc3MsIGF1ZGl0Q2xhc3MpIHtcbiAgYXVkaXRDbGFzcy5zZXREYXRhYmFzZUlkZW50aWZpZXIobW9kZWxDbGFzcy5nZXRDb25maWd1cmVkRGF0YWJhc2VJZGVudGlmaWVyKCkpXG5cbiAgaWYgKG1vZGVsQ2xhc3MuaGFzVGVuYW50RGF0YWJhc2VJZGVudGlmaWVyUmVzb2x2ZXIoKSkge1xuICAgIGF1ZGl0Q2xhc3Muc3dpdGNoZXNUZW5hbnREYXRhYmFzZSgoe3RlbmFudH0pID0+IG1vZGVsQ2xhc3MuZ2V0VGVuYW50RGF0YWJhc2VJZGVudGlmaWVyKHRlbmFudCkpXG4gIH1cbn1cblxuLyoqXG4gKiBXYWxrcyB0aGUgcHJvdG90eXBlIGNoYWluIHRvIGZpbmQgdGhlIHJvb3QgRGF0YWJhc2VSZWNvcmQgY2xhc3MuXG4gKiBAcGFyYW0ge0F1ZGl0ZWRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gQXVkaXRlZCBtb2RlbCBjbGFzcy5cbiAqIEByZXR1cm5zIHt0eXBlb2YgaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBSb290IERhdGFiYXNlUmVjb3JkIGNsYXNzLlxuICovXG5mdW5jdGlvbiBmaW5kRGF0YWJhc2VSZWNvcmRDbGFzcyhtb2RlbENsYXNzKSB7XG4gIGxldCByZWNvcmRDbGFzcyA9IE9iamVjdC5nZXRQcm90b3R5cGVPZihtb2RlbENsYXNzKVxuXG4gIHdoaWxlIChyZWNvcmRDbGFzcyAmJiBPYmplY3QuZ2V0UHJvdG90eXBlT2YocmVjb3JkQ2xhc3MpICE9PSBGdW5jdGlvbi5wcm90b3R5cGUpIHtcbiAgICByZWNvcmRDbGFzcyA9IE9iamVjdC5nZXRQcm90b3R5cGVPZihyZWNvcmRDbGFzcylcbiAgfVxuXG4gIHJldHVybiAvKiogQHR5cGUge3R5cGVvZiBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9ICovIChyZWNvcmRDbGFzcylcbn1cblxuLyoqXG4gKiBSZXR1cm5zIHRoZSBwYXJhbWV0ZXIta2V5IG5hbWUgZm9yIGEgbW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge0F1ZGl0ZWRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gQXVkaXRlZCBtb2RlbCBjbGFzcy5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IGUuZy4gXCJwcm9qZWN0XCIgZm9yIFwiUHJvamVjdFwiLlxuICovXG5mdW5jdGlvbiBtb2RlbFBhcmFtS2V5KG1vZGVsQ2xhc3MpIHtcbiAgY29uc3QgbmFtZSA9IG1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKClcblxuICByZXR1cm4gbmFtZS5jaGFyQXQoMCkudG9Mb3dlckNhc2UoKSArIG5hbWUuc2xpY2UoMSlcbn1cblxuLyoqXG4gKiBSZXR1cm5zIHRoZSBkYXRhYmFzZSBmb3JlaWduLWtleSBjb2x1bW4gZm9yIGEgbW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge0F1ZGl0ZWRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gQXVkaXRlZCBtb2RlbCBjbGFzcy5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IGUuZy4gXCJwcm9qZWN0X2lkXCIgZm9yIFwiUHJvamVjdFwiLlxuICovXG5mdW5jdGlvbiBtb2RlbEZvcmVpZ25LZXkobW9kZWxDbGFzcykge1xuICByZXR1cm4gYCR7aW5mbGVjdGlvbi51bmRlcnNjb3JlKG1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCkpfV9pZGBcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBSZWdpc3RyYXRpb24gKHN5bmMg4oCUIGNhbGxiYWNrcyBvbmx5OyB0YWJsZSBkZXRlY3Rpb24gZGVmZXJyZWQpXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBSZWdpc3RlcnMgbGlmZWN5Y2xlIGNhbGxiYWNrcyBmb3IgYXV0b21hdGljIGNyZWF0ZS91cGRhdGUvZGVzdHJveSBhdWRpdGluZy5cbiAqIFRhYmxlIGRldGVjdGlvbiBhbmQgcmVsYXRpb25zaGlwIHJlZ2lzdHJhdGlvbiBoYXBwZW4gbGF6aWx5IG9uIGZpcnN0IHVzYWdlLlxuICogQ2FsbGVkIHN5bmNocm9ub3VzbHkgZnJvbSBNb2RlbC5hdWRpdGVkKCkgYXQgbW9kdWxlLWxvYWQgdGltZS5cbiAqIEBwYXJhbSB7QXVkaXRlZE1vZGVsQ2xhc3N9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcyB0byBhdWRpdC5cbiAqIEBwYXJhbSB7e2V4Y2VwdD86IHN0cmluZ1tdfX0gW29wdGlvbnNdIC0gQXVkaXQgb3B0aW9uczogYGV4Y2VwdGAgbGlzdHMgYXR0cmlidXRlIG5hbWVzIG5ldmVyIHdyaXR0ZW4gdG8gdGhlIGF1ZGl0IHRyYWlsIChlLmcuIGhpZ2gtZnJlcXVlbmN5IHRlbGVtZXRyeSBjb2x1bW5zKS5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiByZWdpc3RlckF1ZGl0aW5nKG1vZGVsQ2xhc3MsIG9wdGlvbnMgPSB7fSkge1xuICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKG1vZGVsQ2xhc3MsIFwiX2F1ZGl0TGlmZWN5Y2xlQ2FsbGJhY2tzUmVnaXN0ZXJlZFwiKSAmJiBtb2RlbENsYXNzLl9hdWRpdExpZmVjeWNsZUNhbGxiYWNrc1JlZ2lzdGVyZWQpIHtcbiAgICByZXR1cm5cbiAgfVxuXG4gIGNvbnN0IGF1ZGl0YWJsZU1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge0F1ZGl0ZWRNb2RlbENsYXNzICYge19hdWRpdEV4Y2x1ZGVkQXR0cmlidXRlcz86IFNldDxzdHJpbmc+fX0gKi8gKG1vZGVsQ2xhc3MpXG5cbiAgYXVkaXRhYmxlTW9kZWxDbGFzcy5fYXVkaXRMaWZlY3ljbGVDYWxsYmFja3NSZWdpc3RlcmVkID0gdHJ1ZVxuICBhdWRpdGFibGVNb2RlbENsYXNzLl9hdWRpdEV4Y2x1ZGVkQXR0cmlidXRlcyA9IG5ldyBTZXQob3B0aW9ucy5leGNlcHQgfHwgW10pXG4gIHJlZ2lzdGVyQXVkaXRSZWxhdGlvbnNoaXAobW9kZWxDbGFzcylcbiAgbW9kZWxDbGFzcy5iZWZvcmVDcmVhdGUoXCJjYXB0dXJlQ3JlYXRlQXVkaXRDaGFuZ2VzXCIpXG4gIG1vZGVsQ2xhc3MuYWZ0ZXJDcmVhdGUoXCJjcmVhdGVDcmVhdGVBdWRpdFwiKVxuICBtb2RlbENsYXNzLmJlZm9yZVVwZGF0ZShcImNhcHR1cmVVcGRhdGVBdWRpdENoYW5nZXNcIilcbiAgbW9kZWxDbGFzcy5hZnRlclVwZGF0ZShcImNyZWF0ZVVwZGF0ZUF1ZGl0XCIpXG4gIG1vZGVsQ2xhc3MuYWZ0ZXJEZXN0cm95KFwiY3JlYXRlRGVzdHJveUF1ZGl0XCIpXG59XG5cbi8qKlxuICogSW5pdGlhbGl6ZXMgYXVkaXQgbWV0YWRhdGEgZm9yIGF1ZGl0ZWQgbW9kZWwgY2xhc3Nlcy5cbiAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzIHRvIGluaXRpYWxpemUuXG4gKiBAcGFyYW0ge3tyZXNvbHZlVGFibGVEYXRhPzogYm9vbGVhbn19IFthcmdzXSAtIEluaXRpYWxpemF0aW9uIG9wdGlvbnMuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAqL1xuYXN5bmMgZnVuY3Rpb24gaW5pdGlhbGl6ZUF1ZGl0aW5nKG1vZGVsQ2xhc3MsIGFyZ3MgPSB7fSkge1xuICBjb25zdCB7cmVzb2x2ZVRhYmxlRGF0YSA9IGZhbHNlfSA9IGFyZ3NcbiAgY29uc3QgYXVkaXRlZE1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge0F1ZGl0ZWRNb2RlbENsYXNzfSAqLyAobW9kZWxDbGFzcylcblxuICBpZiAoIWF1ZGl0ZWRNb2RlbENsYXNzLl9hdWRpdExpZmVjeWNsZUNhbGxiYWNrc1JlZ2lzdGVyZWQpIHtcbiAgICByZXR1cm5cbiAgfVxuXG4gIHJlZ2lzdGVyQXVkaXRSZWxhdGlvbnNoaXAoYXVkaXRlZE1vZGVsQ2xhc3MpXG5cbiAgaWYgKHJlc29sdmVUYWJsZURhdGEgJiYgc2hvdWxkUmVzb2x2ZUF1ZGl0VGFibGVEYXRhKGF1ZGl0ZWRNb2RlbENsYXNzKSkge1xuICAgIGF3YWl0IHJlc29sdmVBdWRpdFRhYmxlRGF0YShhdWRpdGVkTW9kZWxDbGFzcylcbiAgfVxufVxuXG4vKipcbiAqIFJlc29sdmVzIGF1ZGl0IG1ldGFkYXRhIGFmdGVyIGFwcGxpY2F0aW9uIGFuZCBwYWNrYWdlIG1vZGVsIGNsYXNzZXMgYXJlIHJlZ2lzdGVyZWQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gd2hvc2UgbW9kZWxzIHNob3VsZCBiZSBmaW5hbGl6ZWQuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAqL1xuYXN5bmMgZnVuY3Rpb24gaW5pdGlhbGl6ZUF1ZGl0ZWRNb2RlbFJlbGF0aW9uc2hpcHMoY29uZmlndXJhdGlvbikge1xuICBjb25zdCBtb2RlbENsYXNzZXMgPSBPYmplY3QudmFsdWVzKGNvbmZpZ3VyYXRpb24uZ2V0TW9kZWxDbGFzc2VzKCkpXG4gIGNvbnN0IHNob3VsZFJlc29sdmVUYWJsZURhdGEgPSBtb2RlbENsYXNzZXMuc29tZSgobW9kZWxDbGFzcykgPT4gc2hvdWxkUmVzb2x2ZUF1ZGl0VGFibGVEYXRhKG1vZGVsQ2xhc3MpKVxuXG4gIGlmICghc2hvdWxkUmVzb2x2ZVRhYmxlRGF0YSkge1xuICAgIGZvciAoY29uc3QgbW9kZWxDbGFzcyBvZiBtb2RlbENsYXNzZXMpIHtcbiAgICAgIGF3YWl0IGluaXRpYWxpemVBdWRpdGluZyhtb2RlbENsYXNzKVxuICAgIH1cblxuICAgIHJldHVyblxuICB9XG5cbiAgYXdhaXQgY29uZmlndXJhdGlvbi5lbnN1cmVDb25uZWN0aW9ucyh7bmFtZTogXCJJbml0aWFsaXplIGF1ZGl0ZWQgbW9kZWwgcmVsYXRpb25zaGlwc1wifSwgYXN5bmMgKCkgPT4ge1xuICAgIGZvciAoY29uc3QgbW9kZWxDbGFzcyBvZiBtb2RlbENsYXNzZXMpIHtcbiAgICAgIGF3YWl0IGluaXRpYWxpemVBdWRpdGluZyhtb2RlbENsYXNzLCB7cmVzb2x2ZVRhYmxlRGF0YTogdHJ1ZX0pXG4gICAgfVxuICB9KVxufVxuXG4vKipcbiAqIENoZWNrcyB3aGV0aGVyIGF1ZGl0IHRhYmxlIG1ldGFkYXRhIHNob3VsZCBiZSByZXNvbHZlZCBmb3IgYSBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzIHRvIGluc3BlY3QuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciB0YWJsZSBtZXRhZGF0YSByZXNvbHV0aW9uIHNob3VsZCBydW4gbm93LlxuICovXG5mdW5jdGlvbiBzaG91bGRSZXNvbHZlQXVkaXRUYWJsZURhdGEobW9kZWxDbGFzcykge1xuICBjb25zdCBhdWRpdGVkTW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7QXVkaXRlZE1vZGVsQ2xhc3N9ICovIChtb2RlbENsYXNzKVxuXG4gIGlmICghYXVkaXRlZE1vZGVsQ2xhc3MuX2F1ZGl0TGlmZWN5Y2xlQ2FsbGJhY2tzUmVnaXN0ZXJlZCkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgcmV0dXJuIEJvb2xlYW4oYXVkaXRlZE1vZGVsQ2xhc3MuX2luaXRpYWxpemVkKSAmJiBjYW5SZXNvbHZlQXVkaXRUYWJsZURhdGEoYXVkaXRlZE1vZGVsQ2xhc3MpXG59XG5cbi8qKlxuICogUmVnaXN0ZXJzIHRoZSBhdWRpdHMgcmVsYXRpb25zaGlwIHdpdGhvdXQgZm9yY2luZyBhdWRpdCB0YWJsZSBkZXRlY3Rpb24uXG4gKiBAcGFyYW0ge0F1ZGl0ZWRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MgdG8gYXVkaXQuXG4gKiBAcGFyYW0ge0F1ZGl0VGFibGVEYXRhfSBbdGFibGVEYXRhXSAtIFJlc29sdmVkIGF1ZGl0IHRhYmxlIGRhdGEgd2hlbiBhdmFpbGFibGUuXG4gKiBAcGFyYW0ge3N0cmluZ30gW2RhdGFiYXNlSWRlbnRpdHldIC0gUmVzb2x2ZWQgcGh5c2ljYWwgZGF0YWJhc2UgaWRlbnRpdHkuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gcmVnaXN0ZXJBdWRpdFJlbGF0aW9uc2hpcChtb2RlbENsYXNzLCB0YWJsZURhdGEgPSBkZWZhdWx0QXVkaXRSZWxhdGlvbnNoaXBUYWJsZURhdGEobW9kZWxDbGFzcyksIGRhdGFiYXNlSWRlbnRpdHkpIHtcbiAgaWYgKG1vZGVsQ2xhc3MuX3JlbGF0aW9uc2hpcEV4aXN0cyhcImF1ZGl0c1wiKSkge1xuICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IG1vZGVsQ2xhc3MuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKFwiYXVkaXRzXCIpXG5cbiAgICBpZiAoZ2VuZXJhdGVkQXVkaXRSZWxhdGlvbnNoaXBzLmhhcyhyZWxhdGlvbnNoaXApICYmIGRhdGFiYXNlSWRlbnRpdHkpIHtcbiAgICAgIGF1ZGl0UmVsYXRpb25zaGlwTWFwKG1vZGVsQ2xhc3MpLnNldChkYXRhYmFzZUlkZW50aXR5LCBidWlsZEF1ZGl0UmVsYXRpb25zaGlwKG1vZGVsQ2xhc3MsIHRhYmxlRGF0YSkpXG4gICAgfVxuXG4gICAgcmV0dXJuXG4gIH1cblxuICBtb2RlbENsYXNzLmhhc01hbnkoXCJhdWRpdHNcIiwgYXVkaXRSZWxhdGlvbnNoaXBTY29wZSwge1xuICAgIGZvcmVpZ25LZXk6IHRhYmxlRGF0YS5mb3JlaWduS2V5LFxuICAgIGtsYXNzOiB0YWJsZURhdGEuYXVkaXRDbGFzcyxcbiAgICBwb2x5bW9ycGhpYzogIXRhYmxlRGF0YS5kZWRpY2F0ZWRcbiAgfSlcbiAgY29uc3QgcmVsYXRpb25zaGlwID0gbW9kZWxDbGFzcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUoXCJhdWRpdHNcIilcblxuICBnZW5lcmF0ZWRBdWRpdFJlbGF0aW9uc2hpcHMuYWRkKHJlbGF0aW9uc2hpcClcbiAgcmVsYXRpb25zaGlwLnNldFJlY29yZFJlc29sdmVyKChyZWNvcmQpID0+IHtcbiAgICBjb25zdCByZWxhdGlvbnNoaXBzID0gYXVkaXRSZWxhdGlvbnNoaXBNYXAobW9kZWxDbGFzcylcbiAgICBjb25zdCBvcGVyYXRpb24gPSByZWNvcmQuZGF0YWJhc2VPcGVyYXRpb24oKVxuXG4gICAgaWYgKG9wZXJhdGlvbikgcmV0dXJuIHJlbGF0aW9uc2hpcHMuZ2V0KG9wZXJhdGlvbi5kYXRhYmFzZUlkZW50aXR5KCkpIHx8IHJlbGF0aW9uc2hpcFxuICAgIGlmIChyZWxhdGlvbnNoaXBzLnNpemUgPT09IDEpIHJldHVybiBbLi4ucmVsYXRpb25zaGlwcy52YWx1ZXMoKV1bMF1cblxuICAgIGNvbnN0IGlkZW50aXR5ID0gYXVkaXREYXRhYmFzZUlkZW50aXR5KG1vZGVsQ2xhc3MsIHJlY29yZC5jb25uZWN0aW9uKCkpXG5cbiAgICByZXR1cm4gcmVsYXRpb25zaGlwcy5nZXQoaWRlbnRpdHkpIHx8IHJlbGF0aW9uc2hpcFxuICB9KVxufVxuXG4vKipcbiAqIFJldHVybnMgcGh5c2ljYWwgYXVkaXQgcmVsYXRpb25zaGlwIHZhcmlhbnRzIGZvciBhIG1vZGVsLlxuICogQHBhcmFtIHtBdWRpdGVkTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIEF1ZGl0ZWQgbW9kZWwgY2xhc3MuXG4gKiBAcmV0dXJucyB7TWFwPHN0cmluZywgSGFzTWFueVJlbGF0aW9uc2hpcD59IC0gUmVsYXRpb25zaGlwcyBrZXllZCBieSBwaHlzaWNhbCBkYXRhYmFzZSBpZGVudGl0eS5cbiAqL1xuZnVuY3Rpb24gYXVkaXRSZWxhdGlvbnNoaXBNYXAobW9kZWxDbGFzcykge1xuICBsZXQgcmVsYXRpb25zaGlwcyA9IGF1ZGl0UmVsYXRpb25zaGlwc0J5TW9kZWwuZ2V0KG1vZGVsQ2xhc3MpXG5cbiAgaWYgKCFyZWxhdGlvbnNoaXBzKSB7XG4gICAgcmVsYXRpb25zaGlwcyA9IG5ldyBNYXAoKVxuICAgIGF1ZGl0UmVsYXRpb25zaGlwc0J5TW9kZWwuc2V0KG1vZGVsQ2xhc3MsIHJlbGF0aW9uc2hpcHMpXG4gIH1cblxuICByZXR1cm4gcmVsYXRpb25zaGlwc1xufVxuXG4vKipcbiAqIEJ1aWxkcyBpbW11dGFibGUtYnktb3duZXJzaGlwIGF1ZGl0IHJlbGF0aW9uc2hpcCBtZXRhZGF0YSBmb3Igb25lIHBoeXNpY2FsIGRhdGFiYXNlLlxuICogQHBhcmFtIHtBdWRpdGVkTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIEF1ZGl0ZWQgbW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge0F1ZGl0VGFibGVEYXRhfSB0YWJsZURhdGEgLSBSZXNvbHZlZCBhdWRpdCB0YWJsZSBkYXRhLlxuICogQHJldHVybnMge0hhc01hbnlSZWxhdGlvbnNoaXB9IC0gUGh5c2ljYWwgcmVsYXRpb25zaGlwIGRlZmluaXRpb24uXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkQXVkaXRSZWxhdGlvbnNoaXAobW9kZWxDbGFzcywgdGFibGVEYXRhKSB7XG4gIHJldHVybiBuZXcgSGFzTWFueVJlbGF0aW9uc2hpcCh7XG4gICAgZm9yZWlnbktleTogdGFibGVEYXRhLmZvcmVpZ25LZXksXG4gICAga2xhc3M6IHRhYmxlRGF0YS5hdWRpdENsYXNzLFxuICAgIG1vZGVsQ2xhc3MsXG4gICAgcG9seW1vcnBoaWM6ICF0YWJsZURhdGEuZGVkaWNhdGVkLFxuICAgIHJlbGF0aW9uc2hpcE5hbWU6IFwiYXVkaXRzXCIsXG4gICAgc2NvcGU6IGF1ZGl0UmVsYXRpb25zaGlwU2NvcGUsXG4gICAgdHlwZTogXCJoYXNNYW55XCJcbiAgfSlcbn1cblxuLyoqXG4gKiBSZXR1cm5zIHVucmVzb2x2ZWQgc2hhcmVkLWF1ZGl0IGRlZmF1bHRzIGZvciBlYXJseSByZWxhdGlvbnNoaXAgcmVnaXN0cmF0aW9uLlxuICogQHBhcmFtIHtBdWRpdGVkTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzIHRvIGF1ZGl0LlxuICogQHJldHVybnMge0F1ZGl0VGFibGVEYXRhfSBTaGFyZWQgYXVkaXQgcmVsYXRpb25zaGlwIGRlZmF1bHRzLlxuICovXG5mdW5jdGlvbiBkZWZhdWx0QXVkaXRSZWxhdGlvbnNoaXBUYWJsZURhdGEobW9kZWxDbGFzcykge1xuICByZXR1cm4ge1xuICAgIGF1ZGl0Q2xhc3M6IGNhY2hlZFNoYXJlZEF1ZGl0Q2xhc3MobW9kZWxDbGFzcyksXG4gICAgZGVkaWNhdGVkOiBmYWxzZSxcbiAgICBmb3JlaWduS2V5OiBcImF1ZGl0YWJsZV9pZFwiLFxuICAgIHRhYmxlTmFtZTogXCJhdWRpdHNcIlxuICB9XG59XG5cbi8qKlxuICogQXBwbGllcyBkZWZhdWx0IGF1ZGl0IG9yZGVyaW5nIHRvIGdlbmVyYXRlZCBhdWRpdCByZWxhdGlvbnNoaXBzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSBxdWVyeSAtIEF1ZGl0IHF1ZXJ5LlxuICogQHJldHVybnMge2ltcG9ydChcIi4uL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdD59IE9yZGVyZWQgYXVkaXQgcXVlcnkuXG4gKi9cbmZ1bmN0aW9uIGF1ZGl0UmVsYXRpb25zaGlwU2NvcGUocXVlcnkpIHtcbiAgcmV0dXJuIHF1ZXJ5Lm9yZGVyKHtjb2x1bW46IFwiY3JlYXRlZF9hdFwiLCBkaXJlY3Rpb246IFwiREVTQ1wifSlcbn1cblxuLyoqXG4gKiBDaGVja3Mgd2hldGhlciB0aGUgY3VycmVudCB0ZW5hbnQgY29udGV4dCBjYW4gcmVzb2x2ZSBhdWRpdCB0YWJsZSBkYXRhLlxuICogQHBhcmFtIHtBdWRpdGVkTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzIHRvIGluc3BlY3QuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciBhdWRpdCB0YWJsZSBkYXRhIGNhbiBiZSByZXNvbHZlZCBpbiB0aGUgY3VycmVudCBzY29wZS5cbiAqL1xuZnVuY3Rpb24gY2FuUmVzb2x2ZUF1ZGl0VGFibGVEYXRhKG1vZGVsQ2xhc3MpIHtcbiAgaWYgKCFtb2RlbENsYXNzLmhhc1RlbmFudERhdGFiYXNlSWRlbnRpZmllclJlc29sdmVyKCkpIHtcbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgY29uc3QgdGVuYW50RGF0YWJhc2VJZGVudGlmaWVyID0gbW9kZWxDbGFzcy5nZXRUZW5hbnREYXRhYmFzZUlkZW50aWZpZXIoKVxuXG4gIGlmICghdGVuYW50RGF0YWJhc2VJZGVudGlmaWVyKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICByZXR1cm4gbW9kZWxDbGFzcy5fZ2V0Q29uZmlndXJhdGlvbigpLmlzRGF0YWJhc2VJZGVudGlmaWVyQWN0aXZlKHRlbmFudERhdGFiYXNlSWRlbnRpZmllcilcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBDcmVhdGluZyBhdWRpdHNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIENyZWF0ZXMgYW4gYXVkaXQgcm93IGZvciBhIHJlY29yZC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSByZWNvcmQgLSBSZWNvcmQgdG8gYXVkaXQuXG4gKiBAcGFyYW0ge0NyZWF0ZUF1ZGl0QXJnc30gYXJncyAtIEF1ZGl0IHJvdyBvcHRpb25zIChhY3Rpb24sIGF1ZGl0ZWRDaGFuZ2VzLCBwYXJhbXMpLlxuICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyIHwgc3RyaW5nPn0gQ3JlYXRlZCBhdWRpdCByb3cgaWQuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGNyZWF0ZUF1ZGl0KHJlY29yZCwgYXJncykge1xuICBjb25zdCBtb2RlbENsYXNzID0gLyoqIEB0eXBlIHtBdWRpdGVkTW9kZWxDbGFzc30gKi8gKHJlY29yZC5nZXRNb2RlbENsYXNzKCkpXG4gIGNvbnN0IG9wZXJhdGlvbiA9IHJlY29yZC5kYXRhYmFzZU9wZXJhdGlvbigpXG5cbiAgaWYgKG9wZXJhdGlvbikgcmV0dXJuIGF3YWl0IGNyZWF0ZUF1ZGl0V2l0aEN1cnJlbnRDb25uZWN0aW9uKHJlY29yZCwgYXJncywgbW9kZWxDbGFzcylcblxuICByZXR1cm4gYXdhaXQgbW9kZWxDbGFzcy5fZ2V0Q29uZmlndXJhdGlvbigpLmVuc3VyZUNvbm5lY3Rpb25zKHtuYW1lOiBgJHttb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpfSBhdWRpdGB9LCBhc3luYyAoKSA9PiB7XG4gICAgcmV0dXJuIGF3YWl0IGNyZWF0ZUF1ZGl0V2l0aEN1cnJlbnRDb25uZWN0aW9uKHJlY29yZCwgYXJncywgbW9kZWxDbGFzcylcbiAgfSlcbn1cblxuLyoqXG4gKiBDcmVhdGVzIGFuIGF1ZGl0IHJvdyB1c2luZyB0aGUgY3VycmVudCBtb2RlbCBkYXRhYmFzZSBjb25uZWN0aW9uLlxuICogUm91dGVzIHRvIHNoYXJlZCB0YWJsZSBvciBkZWRpY2F0ZWQgdGFibGUgYmFzZWQgb24gcmVzb2x2ZWQgYXVkaXQgdGFibGUgZGF0YS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSByZWNvcmQgLSBSZWNvcmQgdG8gYXVkaXQuXG4gKiBAcGFyYW0ge0NyZWF0ZUF1ZGl0QXJnc30gYXJncyAtIEF1ZGl0IHJvdyBvcHRpb25zIChhY3Rpb24sIGF1ZGl0ZWRDaGFuZ2VzLCBwYXJhbXMpLlxuICogQHBhcmFtIHtBdWRpdGVkTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIEF1ZGl0ZWQgbW9kZWwgY2xhc3MuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXIgfCBzdHJpbmc+fSBDcmVhdGVkIGF1ZGl0IHJvdyBpZC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gY3JlYXRlQXVkaXRXaXRoQ3VycmVudENvbm5lY3Rpb24ocmVjb3JkLCBhcmdzLCBtb2RlbENsYXNzKSB7XG4gIGlmICghcmVjb3JkLmlzUGVyc2lzdGVkKCkpIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IGF1ZGl0IHVucGVyc2lzdGVkICR7bW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKX0gcmVjb3JkYClcblxuICBjb25zdCBkYiA9IHJlY29yZC5jb25uZWN0aW9uKClcbiAgY29uc3QgdGFibGVEYXRhID0gYXdhaXQgcmVzb2x2ZUF1ZGl0VGFibGVEYXRhKG1vZGVsQ2xhc3MsIGRiLCByZWNvcmQuZGF0YWJhc2VPcGVyYXRpb24oKSlcbiAgY29uc3QgYWN0aW9uID0gbm9ybWFsaXplQWN0aW9uKGFyZ3MuYWN0aW9uKVxuICBjb25zdCBhdWRpdGVkQ2hhbmdlcyA9IGFyZ3MuYXVkaXRlZENoYW5nZXMgPT09IHVuZGVmaW5lZCA/IG51bGwgOiBhcmdzLmF1ZGl0ZWRDaGFuZ2VzXG4gIGNvbnN0IHBhcmFtcyA9IGFyZ3MucGFyYW1zID09PSB1bmRlZmluZWQgPyBudWxsIDogYXJncy5wYXJhbXNcbiAgY29uc3QgY3VycmVudERhdGUgPSBuZXcgRGF0ZSgpXG4gIGNvbnN0IHJlY29yZElkID0gc2NhbGFyTW9kZWxQcmltYXJ5S2V5VmFsdWUocmVjb3JkLmlkKCksIGBBdWRpdGluZyBmb3IgJHttb2RlbENsYXNzLm5hbWV9YClcblxuICBjb25zdCBhdWRpdEFjdGlvbklkID0gYXdhaXQgZmluZE9yQ3JlYXRlTG9va3VwSWQoe1xuICAgIGNvbHVtbk5hbWU6IFwiYWN0aW9uXCIsXG4gICAgY3VycmVudERhdGUsXG4gICAgZGIsXG4gICAgdGFibGVOYW1lOiBcImF1ZGl0X2FjdGlvbnNcIixcbiAgICB2YWx1ZTogYWN0aW9uXG4gIH0pXG5cbiAgY29uc3QgYXVkaXRJZCA9IG5ldyBVVUlEKDQpLmZvcm1hdCgpXG5cbiAgaWYgKHRhYmxlRGF0YS5kZWRpY2F0ZWQpIHtcbiAgICBjb25zdCBmb3JlaWduS2V5ID0gbW9kZWxGb3JlaWduS2V5KG1vZGVsQ2xhc3MpXG5cbiAgICBhd2FpdCBkYi5xdWVyeShkYi5pbnNlcnRTcWwoe1xuICAgICAgcmV0dXJuTGFzdEluc2VydGVkQ29sdW1uTmFtZXM6IFtcImlkXCJdLFxuICAgICAgdGFibGVOYW1lOiB0YWJsZURhdGEudGFibGVOYW1lLFxuICAgICAgZGF0YToge1xuICAgICAgICBpZDogYXVkaXRJZCxcbiAgICAgICAgW2ZvcmVpZ25LZXldOiByZWNvcmRJZCxcbiAgICAgICAgYXVkaXRfYWN0aW9uX2lkOiBhdWRpdEFjdGlvbklkLFxuICAgICAgICBhdWRpdGVkX2NoYW5nZXM6IGF1ZGl0ZWRDaGFuZ2VzLFxuICAgICAgICBwYXJhbXMsXG4gICAgICAgIGNyZWF0ZWRfYXQ6IGN1cnJlbnREYXRlLFxuICAgICAgICB1cGRhdGVkX2F0OiBjdXJyZW50RGF0ZVxuICAgICAgfVxuICAgIH0pKVxuICB9IGVsc2Uge1xuICAgIGNvbnN0IGF1ZGl0QXVkaXRhYmxlVHlwZUlkID0gYXdhaXQgZmluZE9yQ3JlYXRlTG9va3VwSWQoe1xuICAgICAgY29sdW1uTmFtZTogXCJuYW1lXCIsXG4gICAgICBjdXJyZW50RGF0ZSxcbiAgICAgIGRiLFxuICAgICAgdGFibGVOYW1lOiBcImF1ZGl0X2F1ZGl0YWJsZV90eXBlc1wiLFxuICAgICAgdmFsdWU6IG1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKClcbiAgICB9KVxuXG4gICAgYXdhaXQgZGIucXVlcnkoZGIuaW5zZXJ0U3FsKHtcbiAgICAgIHJldHVybkxhc3RJbnNlcnRlZENvbHVtbk5hbWVzOiBbXCJpZFwiXSxcbiAgICAgIHRhYmxlTmFtZTogXCJhdWRpdHNcIixcbiAgICAgIGRhdGE6IHtcbiAgICAgICAgaWQ6IGF1ZGl0SWQsXG4gICAgICAgIGF1ZGl0X2FjdGlvbl9pZDogYXVkaXRBY3Rpb25JZCxcbiAgICAgICAgYXVkaXRfYXVkaXRhYmxlX3R5cGVfaWQ6IGF1ZGl0QXVkaXRhYmxlVHlwZUlkLFxuICAgICAgICBhdWRpdGFibGVfaWQ6IHJlY29yZElkLFxuICAgICAgICBhdWRpdGFibGVfdHlwZTogbW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKSxcbiAgICAgICAgYXVkaXRlZF9jaGFuZ2VzOiBhdWRpdGVkQ2hhbmdlcyxcbiAgICAgICAgcGFyYW1zLFxuICAgICAgICBjcmVhdGVkX2F0OiBjdXJyZW50RGF0ZSxcbiAgICAgICAgdXBkYXRlZF9hdDogY3VycmVudERhdGVcbiAgICAgIH1cbiAgICB9KSlcbiAgfVxuXG4gIGF3YWl0IGVtaXRBdWRpdEV2ZW50KG1vZGVsQ2xhc3MsIGFjdGlvbiwge1xuICAgIGFjdGlvbixcbiAgICBhdWRpdElkLFxuICAgIGF1ZGl0ZWRDaGFuZ2VzLFxuICAgIHBhcmFtcyxcbiAgICByZWNvcmRcbiAgfSlcblxuICBBdWRpdEV2ZW50cy5jYWxsKG1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCksIGFjdGlvbiwge1xuICAgIGFjdGlvbixcbiAgICBhdWRpdElkLFxuICAgIGF1ZGl0ZWRDaGFuZ2VzLFxuICAgIHBhcmFtcyxcbiAgICByZWNvcmRcbiAgfSlcblxuICByZXR1cm4gYXVkaXRJZFxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIExpZmVjeWNsZSBjYWxsYmFja3Ncbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIENhcHR1cmVzIGNyZWF0ZSBjaGFuZ2VzIGJlZm9yZSBwZXJzaXN0ZW5jZSBjbGVhcnMgdGhlIGNoYW5nZSBzZXQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdCAmIHtfcGVuZGluZ0NyZWF0ZUF1ZGl0Q2hhbmdlcz86IEF1ZGl0Q2hhbmdlc319IHJlY29yZCAtIFJlY29yZCB3aG9zZSBwZW5kaW5nIGNoYW5nZXMgc2hvdWxkIGJlIGNhcHR1cmVkLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGNhcHR1cmVDcmVhdGVBdWRpdENoYW5nZXMocmVjb3JkKSB7XG4gIHJlY29yZC5fcGVuZGluZ0NyZWF0ZUF1ZGl0Q2hhbmdlcyA9IGF1ZGl0Q2hhbmdlc0ZvckN1cnJlbnRDaGFuZ2VzKHJlY29yZClcbn1cblxuLyoqXG4gKiBXcml0ZXMgdGhlIGNyZWF0ZSBhdWRpdCByb3cgZm9yIGEgbW9kZWwgaW5zdGFuY2UuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdCAmIHtfcGVuZGluZ0NyZWF0ZUF1ZGl0Q2hhbmdlcz86IEF1ZGl0Q2hhbmdlc319IHJlY29yZCAtIFJlY29yZCB0byBhdWRpdC5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICovXG5hc3luYyBmdW5jdGlvbiBjcmVhdGVDcmVhdGVBdWRpdChyZWNvcmQpIHtcbiAgYXdhaXQgY3JlYXRlQXVkaXQocmVjb3JkLCB7XG4gICAgYWN0aW9uOiBcImNyZWF0ZVwiLFxuICAgIGF1ZGl0ZWRDaGFuZ2VzOiByZWNvcmQuX3BlbmRpbmdDcmVhdGVBdWRpdENoYW5nZXMgfHwgbnVsbFxuICB9KVxuXG4gIHJlY29yZC5fcGVuZGluZ0NyZWF0ZUF1ZGl0Q2hhbmdlcyA9IHVuZGVmaW5lZFxufVxuXG4vKipcbiAqIENhcHR1cmVzIHVwZGF0ZSBjaGFuZ2VzIGJlZm9yZSBwZXJzaXN0ZW5jZSBjbGVhcnMgdGhlIGNoYW5nZSBzZXQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdCAmIHtfcGVuZGluZ1VwZGF0ZUF1ZGl0Q2hhbmdlcz86IEF1ZGl0Q2hhbmdlc319IHJlY29yZCAtIFJlY29yZCB3aG9zZSBwZW5kaW5nIGNoYW5nZXMgc2hvdWxkIGJlIGNhcHR1cmVkLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGNhcHR1cmVVcGRhdGVBdWRpdENoYW5nZXMocmVjb3JkKSB7XG4gIHJlY29yZC5fcGVuZGluZ1VwZGF0ZUF1ZGl0Q2hhbmdlcyA9IGF1ZGl0Q2hhbmdlc0ZvckN1cnJlbnRDaGFuZ2VzKHJlY29yZClcbn1cblxuLyoqXG4gKiBXcml0ZXMgdGhlIHVwZGF0ZSBhdWRpdCByb3cgZm9yIGEgbW9kZWwgaW5zdGFuY2UuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdCAmIHtfcGVuZGluZ1VwZGF0ZUF1ZGl0Q2hhbmdlcz86IEF1ZGl0Q2hhbmdlc319IHJlY29yZCAtIFJlY29yZCB0byBhdWRpdC5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICovXG5hc3luYyBmdW5jdGlvbiBjcmVhdGVVcGRhdGVBdWRpdChyZWNvcmQpIHtcbiAgY29uc3QgYXVkaXRlZENoYW5nZXMgPSByZWNvcmQuX3BlbmRpbmdVcGRhdGVBdWRpdENoYW5nZXMgfHwgbnVsbFxuXG4gIHJlY29yZC5fcGVuZGluZ1VwZGF0ZUF1ZGl0Q2hhbmdlcyA9IHVuZGVmaW5lZFxuXG4gIGlmICghYXVkaXRlZENoYW5nZXMgfHwgT2JqZWN0LmtleXMoYXVkaXRlZENoYW5nZXMpLmxlbmd0aCA8PSAwKSByZXR1cm5cblxuICBhd2FpdCBjcmVhdGVBdWRpdChyZWNvcmQsIHtcbiAgICBhY3Rpb246IFwidXBkYXRlXCIsXG4gICAgYXVkaXRlZENoYW5nZXNcbiAgfSlcbn1cblxuLyoqXG4gKiBXcml0ZXMgdGhlIGRlc3Ryb3kgYXVkaXQgcm93IGZvciBhIG1vZGVsIGluc3RhbmNlLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IHJlY29yZCAtIFJlY29yZCB0byBhdWRpdC5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICovXG5hc3luYyBmdW5jdGlvbiBjcmVhdGVEZXN0cm95QXVkaXQocmVjb3JkKSB7XG4gIGF3YWl0IGNyZWF0ZUF1ZGl0KHJlY29yZCwge1xuICAgIGFjdGlvbjogXCJkZXN0cm95XCIsXG4gICAgYXVkaXRlZENoYW5nZXM6IGF1ZGl0Q2hhbmdlc0ZvckRlc3Ryb3kocmVjb3JkKVxuICB9KVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIENoYW5nZXMgaGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogQ2FwdHVyZXMgdGhlIG5ldyB2YWx1ZXMgZm9yIGZpZWxkcyBjaGFuZ2VkIG9uIGEgcmVjb3JkLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IHJlY29yZCAtIFJlY29yZCB3aG9zZSBwZW5kaW5nIGNoYW5nZXMgc2hvdWxkIGJlIGNhcHR1cmVkLlxuICogQHJldHVybnMge0F1ZGl0Q2hhbmdlc30gTmV3IHZhbHVlcyBrZXllZCBieSBhdHRyaWJ1dGUgbmFtZS5cbiAqL1xuZnVuY3Rpb24gYXVkaXRDaGFuZ2VzRm9yQ3VycmVudENoYW5nZXMocmVjb3JkKSB7XG4gIGNvbnN0IGNoYW5nZXMgPSByZWNvcmQuY2hhbmdlcygpXG4gIC8qKiBAdHlwZSB7QXVkaXRDaGFuZ2VzfSAqL1xuICBjb25zdCBhdWRpdGVkQ2hhbmdlcyA9IHt9XG4gIGNvbnN0IG1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge0F1ZGl0ZWRNb2RlbENsYXNzICYge19hdWRpdEV4Y2x1ZGVkQXR0cmlidXRlcz86IFNldDxzdHJpbmc+fX0gKi8gKHJlY29yZC5nZXRNb2RlbENsYXNzKCkpXG4gIGNvbnN0IGNvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWUgPSBtb2RlbENsYXNzLmdldENvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVNYXAoKVxuICBjb25zdCBleGNsdWRlZEF0dHJpYnV0ZXMgPSBtb2RlbENsYXNzLl9hdWRpdEV4Y2x1ZGVkQXR0cmlidXRlc1xuXG4gIGZvciAoY29uc3QgW2F0dHJpYnV0ZU5hbWUsIGNoYW5nZV0gb2YgT2JqZWN0LmVudHJpZXMoY2hhbmdlcykpIHtcbiAgICBjb25zdCBhdWRpdGVkQXR0cmlidXRlTmFtZSA9IGNvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVbYXR0cmlidXRlTmFtZV0gfHwgYXR0cmlidXRlTmFtZVxuXG4gICAgaWYgKGV4Y2x1ZGVkQXR0cmlidXRlcyAmJiAoZXhjbHVkZWRBdHRyaWJ1dGVzLmhhcyhhdWRpdGVkQXR0cmlidXRlTmFtZSkgfHwgZXhjbHVkZWRBdHRyaWJ1dGVzLmhhcyhhdHRyaWJ1dGVOYW1lKSkpIHtcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgYXVkaXRlZENoYW5nZXNbYXVkaXRlZEF0dHJpYnV0ZU5hbWVdID0gY2hhbmdlWzFdXG4gIH1cblxuICByZXR1cm4gYXVkaXRlZENoYW5nZXNcbn1cblxuLyoqXG4gKiBDYXB0dXJlcyB0aGUgY3VycmVudCBhdHRyaWJ1dGVzIGZvciBhIGRlc3Ryb3kgYXVkaXQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gcmVjb3JkIC0gUmVjb3JkIGJlaW5nIGRlc3Ryb3llZC5cbiAqIEByZXR1cm5zIHtBdWRpdENoYW5nZXN9IEN1cnJlbnQgYXR0cmlidXRlcyBrZXllZCBieSBhdHRyaWJ1dGUgbmFtZS5cbiAqL1xuZnVuY3Rpb24gYXVkaXRDaGFuZ2VzRm9yRGVzdHJveShyZWNvcmQpIHtcbiAgcmV0dXJuIHsuLi5yZWNvcmQuYXR0cmlidXRlcygpfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIHdpdGhvdXRBdWRpdFxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogUmV0dXJucyByZWNvcmRzIHdpdGhvdXQgYW4gYXVkaXQgcm93IGZvciB0aGUgZ2l2ZW4gYWN0aW9uLlxuICogVXNlcyBzaGFyZWQtdGFibGUgZGVmYXVsdHMgd2hlbiB0YWJsZSBkYXRhIGlzIG5vdCB5ZXQgcmVzb2x2ZWQ7XG4gKiBzd2l0Y2hlcyB0byB0aGUgZGVkaWNhdGVkIHRhYmxlIHBhdGggb25jZSByZXNvbHZlZC5cbiAqIEB0ZW1wbGF0ZSB7QXVkaXRlZE1vZGVsQ2xhc3N9IE1DXG4gKiBAcGFyYW0ge01DfSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MgdG8gc2NvcGUuXG4gKiBAcGFyYW0ge3N0cmluZ30gYWN0aW9uIC0gQXVkaXQgYWN0aW9uIHRvIGV4Y2x1ZGUuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDxNQz59IFF1ZXJ5IHNjb3BlZCB0byByZWNvcmRzIHdpdGhvdXQgdGhhdCBhdWRpdCBhY3Rpb24uXG4gKi9cbmZ1bmN0aW9uIHdpdGhvdXRBdWRpdChtb2RlbENsYXNzLCBhY3Rpb24pIHtcbiAgY29uc3QgZGIgPSBtb2RlbENsYXNzLmNvbm5lY3Rpb24oKVxuICBjb25zdCBkYXRhYmFzZUlkZW50aXR5ID0gYXVkaXREYXRhYmFzZUlkZW50aXR5KG1vZGVsQ2xhc3MsIGRiKVxuICBjb25zdCB0YWJsZURhdGEgPSBhdWRpdFRhYmxlRGF0YUJ5TW9kZWwuZ2V0KG1vZGVsQ2xhc3MpPy5nZXQoZGF0YWJhc2VJZGVudGl0eSlcbiAgY29uc3QgbW9kZWxUYWJsZVNxbCA9IGRiLnF1b3RlVGFibGUobW9kZWxDbGFzcy50YWJsZU5hbWUoKSlcbiAgY29uc3QgYXVkaXRBY3Rpb25zVGFibGVTcWwgPSBkYi5xdW90ZVRhYmxlKFwiYXVkaXRfYWN0aW9uc1wiKVxuICBjb25zdCBwcmltYXJ5S2V5ID0gc2NhbGFyTW9kZWxQcmltYXJ5S2V5KG1vZGVsQ2xhc3MucHJpbWFyeUtleSgpLCBgd2l0aG91dEF1ZGl0IGZvciAke21vZGVsQ2xhc3MubmFtZX1gKVxuICBjb25zdCBtb2RlbFByaW1hcnlLZXlTcWwgPSBgJHttb2RlbFRhYmxlU3FsfS4ke2RiLnF1b3RlQ29sdW1uKHByaW1hcnlLZXkpfWBcbiAgY29uc3QgYXVkaXRBY3Rpb25zSWRTcWwgPSBgJHthdWRpdEFjdGlvbnNUYWJsZVNxbH0uJHtkYi5xdW90ZUNvbHVtbihcImlkXCIpfWBcbiAgY29uc3QgYXVkaXRBY3Rpb25zQWN0aW9uU3FsID0gYCR7YXVkaXRBY3Rpb25zVGFibGVTcWx9LiR7ZGIucXVvdGVDb2x1bW4oXCJhY3Rpb25cIil9YFxuXG4gIGlmICh0YWJsZURhdGE/LmRlZGljYXRlZCkge1xuICAgIGNvbnN0IGZvcmVpZ25LZXkgPSBtb2RlbEZvcmVpZ25LZXkobW9kZWxDbGFzcylcbiAgICBjb25zdCBhdWRpdHNUYWJsZVNxbCA9IGRiLnF1b3RlVGFibGUodGFibGVEYXRhLnRhYmxlTmFtZSlcbiAgICBjb25zdCBhdWRpdEFjdGlvbklkU3FsID0gYCR7YXVkaXRzVGFibGVTcWx9LiR7ZGIucXVvdGVDb2x1bW4oXCJhdWRpdF9hY3Rpb25faWRcIil9YFxuICAgIGNvbnN0IG1vZGVsSWRTcWwgPSBgJHthdWRpdHNUYWJsZVNxbH0uJHtkYi5xdW90ZUNvbHVtbihmb3JlaWduS2V5KX1gXG5cbiAgICByZXR1cm4gbW9kZWxDbGFzc1xuICAgICAgLmFsbCgpXG4gICAgICAud2hlcmUoYFxuICAgICAgICBOT1QgRVhJU1RTIChcbiAgICAgICAgICBTRUxFQ1QgMVxuICAgICAgICAgIEZST00gJHthdWRpdHNUYWJsZVNxbH1cbiAgICAgICAgICBJTk5FUiBKT0lOICR7YXVkaXRBY3Rpb25zVGFibGVTcWx9XG4gICAgICAgICAgICBPTiAke2F1ZGl0QWN0aW9uc0lkU3FsfSA9ICR7YXVkaXRBY3Rpb25JZFNxbH1cbiAgICAgICAgICBXSEVSRSAke21vZGVsSWRTcWx9ID0gJHttb2RlbFByaW1hcnlLZXlTcWx9XG4gICAgICAgICAgICBBTkQgJHthdWRpdEFjdGlvbnNBY3Rpb25TcWx9ID0gJHtkYi5xdW90ZShub3JtYWxpemVBY3Rpb24oYWN0aW9uKSl9XG4gICAgICAgIClcbiAgICAgIGApXG4gIH1cblxuICBjb25zdCBhdWRpdHNUYWJsZVNxbCA9IGRiLnF1b3RlVGFibGUoXCJhdWRpdHNcIilcbiAgY29uc3QgYXVkaXRBdWRpdGFibGVJZFNxbCA9IGAke2F1ZGl0c1RhYmxlU3FsfS4ke2RiLnF1b3RlQ29sdW1uKFwiYXVkaXRhYmxlX2lkXCIpfWBcbiAgY29uc3QgYXVkaXRBdWRpdGFibGVUeXBlU3FsID0gYCR7YXVkaXRzVGFibGVTcWx9LiR7ZGIucXVvdGVDb2x1bW4oXCJhdWRpdGFibGVfdHlwZVwiKX1gXG4gIGNvbnN0IGF1ZGl0QWN0aW9uSWRTcWwgPSBgJHthdWRpdHNUYWJsZVNxbH0uJHtkYi5xdW90ZUNvbHVtbihcImF1ZGl0X2FjdGlvbl9pZFwiKX1gXG5cbiAgcmV0dXJuIG1vZGVsQ2xhc3NcbiAgICAuYWxsKClcbiAgICAud2hlcmUoYFxuICAgICAgTk9UIEVYSVNUUyAoXG4gICAgICAgIFNFTEVDVCAxXG4gICAgICAgIEZST00gJHthdWRpdHNUYWJsZVNxbH1cbiAgICAgICAgSU5ORVIgSk9JTiAke2F1ZGl0QWN0aW9uc1RhYmxlU3FsfVxuICAgICAgICAgIE9OICR7YXVkaXRBY3Rpb25zSWRTcWx9ID0gJHthdWRpdEFjdGlvbklkU3FsfVxuICAgICAgICBXSEVSRSAke2F1ZGl0QXVkaXRhYmxlVHlwZVNxbH0gPSAke2RiLnF1b3RlKG1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCkpfVxuICAgICAgICAgIEFORCAke2F1ZGl0QXVkaXRhYmxlSWRTcWx9ID0gJHttb2RlbFByaW1hcnlLZXlTcWx9XG4gICAgICAgICAgQU5EICR7YXVkaXRBY3Rpb25zQWN0aW9uU3FsfSA9ICR7ZGIucXVvdGUobm9ybWFsaXplQWN0aW9uKGFjdGlvbikpfVxuICAgICAgKVxuICAgIGApXG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRXZlbnQgY2FsbGJhY2tzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBSZWdpc3RlcnMgYSBwZXItbW9kZWwgY2FsbGJhY2sgZmlyZWQgYWZ0ZXIgYW4gYXVkaXQgcm93IGlzIGNyZWF0ZWQuXG4gKiBAcGFyYW0ge0F1ZGl0ZWRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MgdG8gb2JzZXJ2ZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhY3Rpb24gLSBBdWRpdCBhY3Rpb24gbmFtZSAoZS5nLiBcImNyZWF0ZVwiKS5cbiAqIEBwYXJhbSB7QXVkaXRDYWxsYmFja30gY2FsbGJhY2sgLSBDYWxsYmFjayBpbnZva2VkIGFmdGVyIG1hdGNoaW5nIGF1ZGl0IHJvd3MgYXJlIGNyZWF0ZWQuXG4gKiBAcmV0dXJucyB7KCkgPT4gdm9pZH0gVW5zdWJzY3JpYmUgZnVuY3Rpb24uXG4gKi9cbmZ1bmN0aW9uIHJlZ2lzdGVyQXVkaXRDYWxsYmFjayhtb2RlbENsYXNzLCBhY3Rpb24sIGNhbGxiYWNrKSB7XG4gIGNvbnN0IG5vcm1hbGl6ZWRBY3Rpb24gPSBub3JtYWxpemVBY3Rpb24oYWN0aW9uKVxuICBjb25zdCBjYWxsYmFja3MgPSBhdWRpdENhbGxiYWNrc0Zvck1vZGVsQ2xhc3MobW9kZWxDbGFzcylcblxuICBpZiAoIWNhbGxiYWNrc1tub3JtYWxpemVkQWN0aW9uXSkge1xuICAgIGNhbGxiYWNrc1tub3JtYWxpemVkQWN0aW9uXSA9IFtdXG4gIH1cblxuICBjYWxsYmFja3Nbbm9ybWFsaXplZEFjdGlvbl0ucHVzaChjYWxsYmFjaylcblxuICByZXR1cm4gKCkgPT4ge1xuICAgIGNvbnN0IGFjdGlvbkNhbGxiYWNrcyA9IGNhbGxiYWNrc1tub3JtYWxpemVkQWN0aW9uXVxuICAgIGNvbnN0IGluZGV4ID0gYWN0aW9uQ2FsbGJhY2tzLmluZGV4T2YoY2FsbGJhY2spXG5cbiAgICBpZiAoaW5kZXggPj0gMCkge1xuICAgICAgYWN0aW9uQ2FsbGJhY2tzLnNwbGljZShpbmRleCwgMSlcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBFbWl0cyBwZXItbW9kZWwgYXVkaXQgY2FsbGJhY2tzIGZvciBhIG1vZGVsL2FjdGlvbiBwYWlyLlxuICogQHBhcmFtIHtBdWRpdGVkTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtzdHJpbmd9IGFjdGlvbiAtIEF1ZGl0IGFjdGlvbi5cbiAqIEBwYXJhbSB7QXVkaXRFdmVudFBheWxvYWR9IHBheWxvYWQgLSBFdmVudCBwYXlsb2FkLlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGVtaXRBdWRpdEV2ZW50KG1vZGVsQ2xhc3MsIGFjdGlvbiwgcGF5bG9hZCkge1xuICBjb25zdCBjYWxsYmFja3MgPSBhdWRpdENhbGxiYWNrc0Zvck1vZGVsQ2xhc3MobW9kZWxDbGFzcylbYWN0aW9uXSB8fCBbXVxuXG4gIGZvciAoY29uc3QgY2FsbGJhY2sgb2YgWy4uLmNhbGxiYWNrc10pIHtcbiAgICBhd2FpdCBjYWxsYmFjayhwYXlsb2FkKVxuICB9XG59XG5cbi8qKlxuICogUmV0dXJucyB0aGUgcGVyLW1vZGVsIGNhbGxiYWNrIG1hcC5cbiAqIEBwYXJhbSB7QXVkaXRlZE1vZGVsQ2xhc3N9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBBdWRpdENhbGxiYWNrW10+fSBDYWxsYmFjayBtYXAga2V5ZWQgYnkgYWN0aW9uLlxuICovXG5mdW5jdGlvbiBhdWRpdENhbGxiYWNrc0Zvck1vZGVsQ2xhc3MobW9kZWxDbGFzcykge1xuICBpZiAoIU9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChtb2RlbENsYXNzLCBcIl9hdWRpdENhbGxiYWNrc1wiKSkge1xuICAgIG1vZGVsQ2xhc3MuX2F1ZGl0Q2FsbGJhY2tzID0ge31cbiAgfVxuXG4gIGNvbnN0IGNhbGxiYWNrcyA9IG1vZGVsQ2xhc3MuX2F1ZGl0Q2FsbGJhY2tzXG5cbiAgaWYgKCFjYWxsYmFja3MpIHRocm93IG5ldyBFcnJvcihgQXVkaXQgY2FsbGJhY2tzIHdlcmVuJ3QgaW5pdGlhbGl6ZWQgZm9yICR7bW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKX1gKVxuXG4gIHJldHVybiBjYWxsYmFja3Ncbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBMb29rdXAgaGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogRmluZHMgb3IgY3JlYXRlcyBhIGxvb2t1cCByb3cgYW5kIHJldHVybnMgaXRzIGlkLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbHVtbk5hbWUgLSBMb29rdXAgdmFsdWUgY29sdW1uIG5hbWUuXG4gKiBAcGFyYW0ge0RhdGV9IGFyZ3MuY3VycmVudERhdGUgLSBUaW1lc3RhbXAgdG8gd3JpdGUgd2hlbiBpbnNlcnRpbmcuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLmRiIC0gRGF0YWJhc2UgZHJpdmVyLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudGFibGVOYW1lIC0gTG9va3VwIHRhYmxlIG5hbWUuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy52YWx1ZSAtIExvb2t1cCB2YWx1ZS5cbiAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlciB8IHN0cmluZz59IExvb2t1cCByb3cgaWQuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGZpbmRPckNyZWF0ZUxvb2t1cElkKHtjb2x1bW5OYW1lLCBjdXJyZW50RGF0ZSwgZGIsIHRhYmxlTmFtZSwgdmFsdWV9KSB7XG4gIGF3YWl0IGRiLnVwc2VydCh7XG4gICAgdGFibGVOYW1lLFxuICAgIGNvbmZsaWN0Q29sdW1uczogW2NvbHVtbk5hbWVdLFxuICAgIHVwZGF0ZUNvbHVtbnM6IFtjb2x1bW5OYW1lXSxcbiAgICBkYXRhOiB7XG4gICAgICBpZDogbmV3IFVVSUQoNCkuZm9ybWF0KCksXG4gICAgICBbY29sdW1uTmFtZV06IHZhbHVlLFxuICAgICAgY3JlYXRlZF9hdDogY3VycmVudERhdGUsXG4gICAgICB1cGRhdGVkX2F0OiBjdXJyZW50RGF0ZVxuICAgIH1cbiAgfSlcblxuICBjb25zdCBpZCA9IGF3YWl0IGZpbmRMb29rdXBJZCh7Y29sdW1uTmFtZSwgZGIsIHRhYmxlTmFtZSwgdmFsdWV9KVxuXG4gIGlmIChpZCA9PT0gbnVsbCkgdGhyb3cgbmV3IEVycm9yKGBDb3VsZG4ndCBmaW5kICR7dGFibGVOYW1lfS4ke2NvbHVtbk5hbWV9IGFmdGVyIHVwc2VydGApXG5cbiAgcmV0dXJuIGlkXG59XG5cbi8qKlxuICogRmluZHMgYSBsb29rdXAgaWQgYnkgdmFsdWUuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY29sdW1uTmFtZSAtIExvb2t1cCB2YWx1ZSBjb2x1bW4gbmFtZS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MuZGIgLSBEYXRhYmFzZSBkcml2ZXIuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy50YWJsZU5hbWUgLSBMb29rdXAgdGFibGUgbmFtZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnZhbHVlIC0gTG9va3VwIHZhbHVlLlxuICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyIHwgc3RyaW5nIHwgbnVsbD59IExvb2t1cCByb3cgaWQgb3IgbnVsbC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gZmluZExvb2t1cElkKHtjb2x1bW5OYW1lLCBkYiwgdGFibGVOYW1lLCB2YWx1ZX0pIHtcbiAgY29uc3Qgcm93cyA9IC8qKiBAdHlwZSB7QXJyYXk8e2lkOiBudW1iZXIgfCBzdHJpbmd9Pn0gKi8gKGF3YWl0IGRiLnF1ZXJ5KGBcbiAgICBTRUxFQ1QgJHtkYi5xdW90ZUNvbHVtbihcImlkXCIpfSBBUyBpZFxuICAgIEZST00gJHtkYi5xdW90ZVRhYmxlKHRhYmxlTmFtZSl9XG4gICAgV0hFUkUgJHtkYi5xdW90ZUNvbHVtbihjb2x1bW5OYW1lKX0gPSAke2RiLnF1b3RlKHZhbHVlKX1cbiAgYCkpXG5cbiAgaWYgKHJvd3NbMF0pIHJldHVybiByb3dzWzBdLmlkXG5cbiAgcmV0dXJuIG51bGxcbn1cblxuLyoqXG4gKiBOb3JtYWxpemVzIGFuIGF1ZGl0IGFjdGlvbiBzdHJpbmcuXG4gKiBAcGFyYW0ge3N0cmluZ30gYWN0aW9uIC0gQWN0aW9uIG5hbWUuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSBUcmltbWVkLCBub24tZW1wdHkgYWN0aW9uIG5hbWUuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUFjdGlvbihhY3Rpb24pIHtcbiAgY29uc3Qgbm9ybWFsaXplZEFjdGlvbiA9IGFjdGlvbi50cmltKClcblxuICBpZiAoIW5vcm1hbGl6ZWRBY3Rpb24pIHRocm93IG5ldyBFcnJvcihcIkF1ZGl0IGFjdGlvbiBtdXN0IGJlIHByZXNlbnRcIilcblxuICByZXR1cm4gbm9ybWFsaXplZEFjdGlvblxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIE1pZ3JhdGlvbiBoZWxwZXJzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBDcmVhdGVzIHRoZSBzaGFyZWQgYXVkaXQgdGFibGVzIG1pZ3JhdGlvbiB1cC9kb3duIGNhbGxiYWNrcyBmb3IgdXNlIGluc2lkZVxuICogYSBNaWdyYXRpb24gY2xhc3MuIFRoZSBgdGFibGVgIHBhcmFtZXRlciBpcyBhIE1pZ3JhdGlvbiBpbnN0YW5jZS5cbiAqIEBwYXJhbSB7e2lkPzoge3R5cGU6IHN0cmluZ319fSBbb3B0aW9uc10gLSBJRCBjb2x1bW4gb3B0aW9ucy5cbiAqIEByZXR1cm5zIHt7ZG93bjogKHRhYmxlOiBpbXBvcnQoXCIuLi9taWdyYXRpb24vaW5kZXguanNcIikuZGVmYXVsdCkgPT4gUHJvbWlzZTx2b2lkPiwgdXA6ICh0YWJsZTogaW1wb3J0KFwiLi4vbWlncmF0aW9uL2luZGV4LmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8dm9pZD59fSAtIFVwL2Rvd24gY2FsbGJhY2tzIGZvciB0aGUgc2hhcmVkIGF1ZGl0IHRhYmxlcy5cbiAqL1xuZnVuY3Rpb24gY3JlYXRlU2hhcmVkQXVkaXRUYWJsZXNNaWdyYXRpb24ob3B0aW9ucyA9IHt9KSB7XG4gIGNvbnN0IG9wdHMgPSAvKiogQHR5cGUge3tpZD86IHt0eXBlOiBzdHJpbmd9fX0gKi8gKG9wdGlvbnMpXG4gIGNvbnN0IGlkT3B0aW9ucyA9IC8qKiBAdHlwZSB7e3R5cGU/OiBzdHJpbmd9fSAqLyAob3B0cy5pZCB8fCB7fSlcbiAgY29uc3QgdHlwZSA9IGlkT3B0aW9ucy50eXBlXG5cbiAgcmV0dXJuIHtcbiAgICBhc3luYyB1cCh0YWJsZSkge1xuICAgICAgYXdhaXQgdGFibGUuY3JlYXRlVGFibGUoXCJhdWRpdF9hY3Rpb25zXCIsIHtpZDogLyoqIEB0eXBlIHt7dHlwZT86IHN0cmluZ319ICovIChvcHRzLmlkIHx8IHt9KX0sICgvKiogQHR5cGUge3tzdHJpbmcobmFtZTogc3RyaW5nLCBvcHRpb25zOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHZvaWQsIHRpbWVzdGFtcHMoKTogdm9pZH19ICovIHQpID0+IHtcbiAgICAgICAgdC5zdHJpbmcoXCJhY3Rpb25cIiwge2luZGV4OiB7dW5pcXVlOiB0cnVlfSwgbnVsbDogZmFsc2V9KVxuICAgICAgICB0LnRpbWVzdGFtcHMoKVxuICAgICAgfSlcblxuICAgICAgYXdhaXQgdGFibGUuY3JlYXRlVGFibGUoXCJhdWRpdF9hdWRpdGFibGVfdHlwZXNcIiwge2lkOiAvKiogQHR5cGUge3t0eXBlPzogc3RyaW5nfX0gKi8gKG9wdHMuaWQgfHwge30pfSwgKC8qKiBAdHlwZSB7e3N0cmluZyhuYW1lOiBzdHJpbmcsIG9wdGlvbnM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogdm9pZCwgdGltZXN0YW1wcygpOiB2b2lkfX0gKi8gdCkgPT4ge1xuICAgICAgICB0LnN0cmluZyhcIm5hbWVcIiwge2luZGV4OiB7dW5pcXVlOiB0cnVlfSwgbnVsbDogZmFsc2V9KVxuICAgICAgICB0LnRpbWVzdGFtcHMoKVxuICAgICAgfSlcblxuICAgICAgYXdhaXQgdGFibGUuY3JlYXRlVGFibGUoXCJhdWRpdHNcIiwge2lkOiAvKiogQHR5cGUge3t0eXBlPzogc3RyaW5nfX0gKi8gKG9wdHMuaWQgfHwge30pfSwgKC8qKiBAdHlwZSB7e2pzb24obmFtZTogc3RyaW5nKTogdm9pZCwgcmVmZXJlbmNlcyhuYW1lOiBzdHJpbmcsIG9wdGlvbnM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogdm9pZCwgdGltZXN0YW1wcygpOiB2b2lkfX0gKi8gdCkgPT4ge1xuICAgICAgICB0LnJlZmVyZW5jZXMoXCJhdWRpdF9hY3Rpb25cIiwge2ZvcmVpZ25LZXk6IHRydWUsIG51bGw6IGZhbHNlLCB0eXBlfSlcbiAgICAgICAgdC5yZWZlcmVuY2VzKFwiYXVkaXRfYXVkaXRhYmxlX3R5cGVcIiwge2ZvcmVpZ25LZXk6IHRydWUsIG51bGw6IGZhbHNlLCB0eXBlfSlcbiAgICAgICAgdC5yZWZlcmVuY2VzKFwiYXVkaXRhYmxlXCIsIHtudWxsOiBmYWxzZSwgcG9seW1vcnBoaWM6IHRydWUsIHR5cGV9KVxuICAgICAgICB0Lmpzb24oXCJhdWRpdGVkX2NoYW5nZXNcIilcbiAgICAgICAgdC5qc29uKFwicGFyYW1zXCIpXG4gICAgICAgIHQudGltZXN0YW1wcygpXG4gICAgICB9KVxuICAgIH0sXG5cbiAgICBhc3luYyBkb3duKHRhYmxlKSB7XG4gICAgICBhd2FpdCB0YWJsZS5kcm9wVGFibGUoXCJhdWRpdHNcIilcbiAgICAgIGF3YWl0IHRhYmxlLmRyb3BUYWJsZShcImF1ZGl0X2F1ZGl0YWJsZV90eXBlc1wiKVxuICAgICAgYXdhaXQgdGFibGUuZHJvcFRhYmxlKFwiYXVkaXRfYWN0aW9uc1wiKVxuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIFJldHVybnMgdGhlIGRlZGljYXRlZCBhdWRpdCB0YWJsZSBuYW1lIGZvciBhIGdpdmVuIG1vZGVsIHRhYmxlIG5hbWUuXG4gKiBAcGFyYW0ge3N0cmluZ30gbW9kZWxUYWJsZU5hbWUgLSBNb2RlbCB0YWJsZSBuYW1lIChlLmcuIFwicHJvamVjdHNcIikuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSBEZWRpY2F0ZWQgYXVkaXQgdGFibGUgbmFtZSAoZS5nLiBcInByb2plY3RfYXVkaXRzXCIpLlxuICovXG5mdW5jdGlvbiBkZWRpY2F0ZWRBdWRpdFRhYmxlTmFtZUZvclRhYmxlKG1vZGVsVGFibGVOYW1lKSB7XG4gIGlmIChtb2RlbFRhYmxlTmFtZS5lbmRzV2l0aChcInNcIikpIHtcbiAgICByZXR1cm4gYCR7bW9kZWxUYWJsZU5hbWUuc2xpY2UoMCwgLTEpfV9hdWRpdHNgXG4gIH1cblxuICByZXR1cm4gYCR7bW9kZWxUYWJsZU5hbWV9X2F1ZGl0c2Bcbn1cblxuZXhwb3J0IHtcbiAgQXVkaXRFdmVudHMsXG4gIGNhcHR1cmVDcmVhdGVBdWRpdENoYW5nZXMsXG4gIGNhcHR1cmVVcGRhdGVBdWRpdENoYW5nZXMsXG4gIGNyZWF0ZUF1ZGl0LFxuICBjcmVhdGVDcmVhdGVBdWRpdCxcbiAgY3JlYXRlRGVzdHJveUF1ZGl0LFxuICBjcmVhdGVVcGRhdGVBdWRpdCxcbiAgY3JlYXRlU2hhcmVkQXVkaXRUYWJsZXNNaWdyYXRpb24sXG4gIGRlZGljYXRlZEF1ZGl0VGFibGVOYW1lRm9yVGFibGUsXG4gIGluaXRpYWxpemVBdWRpdGVkTW9kZWxSZWxhdGlvbnNoaXBzLFxuICBpbml0aWFsaXplQXVkaXRpbmcsXG4gIHJlZ2lzdGVyQXVkaXRDYWxsYmFjayxcbiAgcmVnaXN0ZXJBdWRpdGluZyxcbiAgd2l0aG91dEF1ZGl0XG59XG4iXX0=