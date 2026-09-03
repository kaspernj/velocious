// @ts-check
import UUID from "pure-uuid";
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
        const modelKey = modelParamKey(modelClass);
        return {
            auditClass,
            dedicated: true,
            foreignKey: `${modelKey}_id`,
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
// ---------------------------------------------------------------------------
// Registration (sync — callbacks only; table detection deferred)
// ---------------------------------------------------------------------------
/**
 * Registers lifecycle callbacks for automatic create/update/destroy auditing.
 * Table detection and relationship registration happen lazily on first usage.
 * Called synchronously from Model.audited() at module-load time.
 * @param {AuditedModelClass} modelClass - Model class to audit.
 * @returns {void}
 */
function registerAuditing(modelClass) {
    if (Object.prototype.hasOwnProperty.call(modelClass, "_auditLifecycleCallbacksRegistered") && modelClass._auditLifecycleCallbacksRegistered) {
        return;
    }
    modelClass._auditLifecycleCallbacksRegistered = true;
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
        const modelKey = modelParamKey(modelClass);
        await db.query(db.insertSql({
            returnLastInsertedColumnNames: ["id"],
            tableName: tableData.tableName,
            data: {
                id: auditId,
                [`${modelKey}_id`]: recordId,
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
    const columnNameToAttributeName = record.getModelClass().getColumnNameToAttributeNameMap();
    for (const [attributeName, change] of Object.entries(changes)) {
        auditedChanges[columnNameToAttributeName[attributeName] || attributeName] = change[1];
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
        const modelKey = modelParamKey(modelClass);
        const auditsTableSql = db.quoteTable(tableData.tableName);
        const auditActionIdSql = `${auditsTableSql}.${db.quoteColumn("audit_action_id")}`;
        const modelIdSql = `${auditsTableSql}.${db.quoteColumn(`${modelKey}_id`)}`;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXVkaXRpbmcuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcmVjb3JkL2F1ZGl0aW5nLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFDNUIsT0FBTyxtQkFBbUIsTUFBTSw2QkFBNkIsQ0FBQTtBQUM3RCxPQUFPLEVBQUMscUJBQXFCLEVBQUUsMEJBQTBCLEVBQUMsTUFBTSxrQ0FBa0MsQ0FBQTtBQUVsRzs7Ozs7O0dBTUc7QUFDSDs7O0dBR0c7QUFFSDs7Ozs7Ozs7R0FRRztBQUVIOzs7R0FHRztBQUVIOzs7Ozs7R0FNRztBQUVIOzs7Ozs7OztHQVFHO0FBRUg7Ozs7Ozs7R0FPRztBQUVILHNGQUFzRjtBQUN0RixNQUFNLGtDQUFrQyxHQUFHLElBQUksT0FBTyxFQUFFLENBQUE7QUFFeEQsc0VBQXNFO0FBQ3RFLE1BQU0scUJBQXFCLEdBQUcsSUFBSSxPQUFPLEVBQUUsQ0FBQTtBQUUzQywrREFBK0Q7QUFDL0QsTUFBTSxlQUFlLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtBQUVqQyxNQUFNLDJCQUEyQixHQUFHLElBQUksT0FBTyxFQUFFLENBQUE7QUFFakQsMkVBQTJFO0FBQzNFLE1BQU0seUJBQXlCLEdBQUcsSUFBSSxPQUFPLEVBQUUsQ0FBQTtBQUUvQyw4RUFBOEU7QUFDOUUsd0RBQXdEO0FBQ3hELDhFQUE4RTtBQUU5RSx1RkFBdUY7QUFDdkYsSUFBSSxzQkFBc0IsR0FBRyxFQUFFLENBQUE7QUFFL0IsOEJBQThCO0FBQzlCLE1BQU0sV0FBVyxHQUFHO0lBQ2xCOzs7OztPQUtHO0lBQ0gsSUFBSSxDQUFDLElBQUksRUFBRSxNQUFNLEVBQUUsSUFBSTtRQUNyQixNQUFNLE9BQU8sR0FBRyxzQkFBc0IsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUE7UUFDbEQsTUFBTSxTQUFTLEdBQUcsT0FBTyxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsQ0FBQTtRQUV2QyxLQUFLLE1BQU0sUUFBUSxJQUFJLENBQUMsR0FBRyxTQUFTLENBQUMsRUFBRSxDQUFDO1lBQ3RDLFFBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUNoQixDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILE9BQU8sQ0FBQyxJQUFJLEVBQUUsTUFBTSxFQUFFLFFBQVE7UUFDNUIsSUFBSSxDQUFDLHNCQUFzQixDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7WUFDbEMsc0JBQXNCLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFBO1FBQ25DLENBQUM7UUFFRCxJQUFJLENBQUMsc0JBQXNCLENBQUMsSUFBSSxDQUFDLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQztZQUMxQyxzQkFBc0IsQ0FBQyxJQUFJLENBQUMsQ0FBQyxNQUFNLENBQUMsR0FBRyxFQUFFLENBQUE7UUFDM0MsQ0FBQztRQUVELHNCQUFzQixDQUFDLElBQUksQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUVuRCxPQUFPLEdBQUcsRUFBRTtZQUNWLE1BQU0sSUFBSSxHQUFHLHNCQUFzQixDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsTUFBTSxDQUFDLENBQUE7WUFFbkQsSUFBSSxJQUFJLEVBQUUsQ0FBQztnQkFDVCxNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxDQUFBO2dCQUVwQyxJQUFJLEtBQUssSUFBSSxDQUFDLEVBQUUsQ0FBQztvQkFDZixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssRUFBRSxDQUFDLENBQUMsQ0FBQTtnQkFDdkIsQ0FBQztZQUNILENBQUM7UUFDSCxDQUFDLENBQUE7SUFDSCxDQUFDO0lBRUQsc0NBQXNDO0lBQ3RDLEtBQUs7UUFDSCxzQkFBc0IsR0FBRyxFQUFFLENBQUE7SUFDN0IsQ0FBQztDQUNGLENBQUE7QUFFRCw4RUFBOEU7QUFDOUUsa0JBQWtCO0FBQ2xCLDhFQUE4RTtBQUU5RTs7OztHQUlHO0FBQ0gsU0FBUyx1QkFBdUIsQ0FBQyxVQUFVO0lBQ3pDLE1BQU0sS0FBSyxHQUFHLFVBQVUsQ0FBQyxTQUFTLEVBQUUsQ0FBQTtJQUVwQyxJQUFJLEtBQUssQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUN4QixPQUFPLEdBQUcsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFBO0lBQ3ZDLENBQUM7SUFFRCxPQUFPLEdBQUcsS0FBSyxTQUFTLENBQUE7QUFDMUIsQ0FBQztBQUVEOzs7Ozs7O0dBT0c7QUFDSCxLQUFLLFVBQVUscUJBQXFCLENBQUMsVUFBVSxFQUFFLFVBQVUsRUFBRSxTQUFTO0lBQ3BFLE1BQU0sa0JBQWtCLEdBQUcsVUFBVSxJQUFJLFVBQVUsQ0FBQyxVQUFVLEVBQUUsQ0FBQTtJQUNoRSxNQUFNLGdCQUFnQixHQUFHLHFCQUFxQixDQUFDLFVBQVUsRUFBRSxrQkFBa0IsRUFBRSxTQUFTLENBQUMsQ0FBQTtJQUN6RixJQUFJLG1CQUFtQixHQUFHLHFCQUFxQixDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsQ0FBQTtJQUUvRCxJQUFJLENBQUMsbUJBQW1CLEVBQUUsQ0FBQztRQUN6QixtQkFBbUIsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO1FBQy9CLHFCQUFxQixDQUFDLEdBQUcsQ0FBQyxVQUFVLEVBQUUsbUJBQW1CLENBQUMsQ0FBQTtJQUM1RCxDQUFDO0lBRUQsTUFBTSxlQUFlLEdBQUcsbUJBQW1CLENBQUMsR0FBRyxDQUFDLGdCQUFnQixDQUFDLENBQUE7SUFFakUsSUFBSSxlQUFlLEVBQUUsQ0FBQztRQUNwQix5QkFBeUIsQ0FBQyxVQUFVLEVBQUUsZUFBZSxFQUFFLGdCQUFnQixDQUFDLENBQUE7UUFDeEUsT0FBTyxlQUFlLENBQUE7SUFDeEIsQ0FBQztJQUVELE1BQU0sU0FBUyxHQUFHLE1BQU0sbUJBQW1CLENBQUMsVUFBVSxFQUFFLGtCQUFrQixFQUFFLGdCQUFnQixDQUFDLENBQUE7SUFDN0YsTUFBTSxhQUFhLEdBQUcsVUFBVSxDQUFDLGlCQUFpQixFQUFFLENBQUE7SUFFcEQsU0FBUyxDQUFDLFVBQVUsQ0FBQyxtQkFBbUIsQ0FBQyxFQUFDLGFBQWEsRUFBQyxDQUFDLENBQUE7SUFDekQsTUFBTSxTQUFTLENBQUMsVUFBVSxDQUFDLGdCQUFnQixDQUFDLEVBQUMsYUFBYSxFQUFFLFVBQVUsRUFBRSxrQkFBa0IsRUFBQyxDQUFDLENBQUE7SUFFNUYsVUFBVSxDQUFDLGVBQWUsR0FBRyxTQUFTLENBQUE7SUFDdEMsVUFBVSxDQUFDLG1CQUFtQixHQUFHLElBQUksQ0FBQTtJQUNyQyxtQkFBbUIsQ0FBQyxHQUFHLENBQUMsZ0JBQWdCLEVBQUUsU0FBUyxDQUFDLENBQUE7SUFFcEQseUJBQXlCLENBQUMsVUFBVSxFQUFFLFNBQVMsRUFBRSxnQkFBZ0IsQ0FBQyxDQUFBO0lBRWxFLE9BQU8sU0FBUyxDQUFBO0FBQ2xCLENBQUM7QUFFRDs7Ozs7Ozs7R0FRRztBQUNILEtBQUssVUFBVSxtQkFBbUIsQ0FBQyxVQUFVLEVBQUUsVUFBVSxFQUFFLGdCQUFnQjtJQUN6RSxNQUFNLGNBQWMsR0FBRyx1QkFBdUIsQ0FBQyxVQUFVLENBQUMsQ0FBQTtJQUMxRCxNQUFNLGVBQWUsR0FBRyxNQUFNLGlDQUFpQyxDQUFDLFVBQVUsRUFBRSxjQUFjLEVBQUUsVUFBVSxFQUFFLGdCQUFnQixDQUFDLENBQUE7SUFFekgsSUFBSSxlQUFlLEVBQUUsQ0FBQztRQUNwQixNQUFNLFVBQVUsR0FBRyxtQkFBbUIsQ0FBQyxVQUFVLEVBQUUsY0FBYyxDQUFDLENBQUE7UUFDbEUsTUFBTSxRQUFRLEdBQUcsYUFBYSxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBRTFDLE9BQU87WUFDTCxVQUFVO1lBQ1YsU0FBUyxFQUFFLElBQUk7WUFDZixVQUFVLEVBQUUsR0FBRyxRQUFRLEtBQUs7WUFDNUIsU0FBUyxFQUFFLGNBQWM7U0FDMUIsQ0FBQTtJQUNILENBQUM7SUFFRCxNQUFNLGFBQWEsR0FBRyxVQUFVLENBQUMsaUJBQWlCLEVBQUUsQ0FBQTtJQUVwRCxNQUFNLGtCQUFrQixHQUFHLGFBQWEsQ0FBQyxlQUFlLEVBQUUsQ0FBQyxLQUFLLENBQUE7SUFFaEUsSUFBSSxrQkFBa0IsRUFBRSxDQUFDO1FBQ3ZCLE9BQU87WUFDTCxVQUFVLEVBQUUsa0JBQWtCO1lBQzlCLFNBQVMsRUFBRSxLQUFLO1lBQ2hCLFVBQVUsRUFBRSxjQUFjO1lBQzFCLFNBQVMsRUFBRSxRQUFRO1NBQ3BCLENBQUE7SUFDSCxDQUFDO0lBRUQsT0FBTztRQUNMLFVBQVUsRUFBRSxzQkFBc0IsQ0FBQyxVQUFVLENBQUM7UUFDOUMsU0FBUyxFQUFFLEtBQUs7UUFDaEIsVUFBVSxFQUFFLGNBQWM7UUFDMUIsU0FBUyxFQUFFLFFBQVE7S0FDcEIsQ0FBQTtBQUNILENBQUM7QUFFRDs7Ozs7OztHQU9HO0FBQ0gsS0FBSyxVQUFVLGlDQUFpQyxDQUFDLFVBQVUsRUFBRSxTQUFTLEVBQUUsVUFBVSxFQUFFLGdCQUFnQjtJQUNsRyxNQUFNLGFBQWEsR0FBRyxVQUFVLENBQUMsaUJBQWlCLEVBQUUsQ0FBQTtJQUNwRCxNQUFNLFFBQVEsR0FBRyxHQUFHLGdCQUFnQixJQUFJLFNBQVMsRUFBRSxDQUFBO0lBQ25ELElBQUksbUJBQW1CLEdBQUcsa0NBQWtDLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyxDQUFBO0lBRS9FLElBQUksQ0FBQyxtQkFBbUIsRUFBRSxDQUFDO1FBQ3pCLG1CQUFtQixHQUFHLElBQUksR0FBRyxFQUFFLENBQUE7UUFDL0Isa0NBQWtDLENBQUMsR0FBRyxDQUFDLGFBQWEsRUFBRSxtQkFBbUIsQ0FBQyxDQUFBO0lBQzVFLENBQUM7SUFFRCxNQUFNLE1BQU0sR0FBRyxtQkFBbUIsQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLENBQUE7SUFFaEQsSUFBSSxPQUFPLE1BQU0sS0FBSyxTQUFTLEVBQUUsQ0FBQztRQUNoQyxPQUFPLE1BQU0sQ0FBQTtJQUNmLENBQUM7SUFFRCxNQUFNLEtBQUssR0FBRyxNQUFNLFVBQVUsQ0FBQyxjQUFjLENBQUMsU0FBUyxFQUFFLEVBQUMsVUFBVSxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7SUFDN0UsTUFBTSxNQUFNLEdBQUcsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFBO0lBRTdCLG1CQUFtQixDQUFDLEdBQUcsQ0FBQyxRQUFRLEVBQUUsTUFBTSxDQUFDLENBQUE7SUFFekMsT0FBTyxNQUFNLENBQUE7QUFDZixDQUFDO0FBRUQ7Ozs7Ozs7O0dBUUc7QUFDSCxTQUFTLHFCQUFxQixDQUFDLFVBQVUsRUFBRSxVQUFVLEVBQUUsU0FBUztJQUM5RCxJQUFJLFNBQVM7UUFBRSxPQUFPLFNBQVMsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFBO0lBRWxELE1BQU0sa0JBQWtCLEdBQUcsVUFBVSxDQUFDLHFCQUFxQixFQUFFLENBQUE7SUFDN0QsTUFBTSxJQUFJLEdBQUcsVUFBVSxDQUFDLGlCQUFpQixFQUFFLENBQUMsZUFBZSxDQUFDLGtCQUFrQixDQUFDLENBQUE7SUFFL0UsT0FBTyxHQUFHLGtCQUFrQixJQUFJLElBQUksQ0FBQyxrQ0FBa0MsQ0FBQyxVQUFVLENBQUMsRUFBRSxDQUFBO0FBQ3ZGLENBQUM7QUFFRCw4RUFBOEU7QUFDOUUsd0JBQXdCO0FBQ3hCLDhFQUE4RTtBQUU5RTs7Ozs7R0FLRztBQUNILFNBQVMsZ0JBQWdCLENBQUMsVUFBVTtJQUNsQyxNQUFNLGFBQWEsR0FBRyx1QkFBdUIsQ0FBQyxVQUFVLENBQUMsQ0FBQTtJQUV6RDs7T0FFRztJQUNILE1BQU0sS0FBTSxTQUFRLGFBQWE7UUFDL0I7OztXQUdHO1FBQ0gsTUFBTSxDQUFDLFNBQVM7WUFDZCxPQUFPLFFBQVEsQ0FBQTtRQUNqQixDQUFDO0tBQ0Y7SUFFRCxNQUFNLENBQUMsY0FBYyxDQUFDLEtBQUssRUFBRSxXQUFXLEVBQUUsRUFBQyxLQUFLLEVBQUUsT0FBTyxFQUFFLFFBQVEsRUFBRSxLQUFLLEVBQUMsQ0FBQyxDQUFBO0lBQzVFLDhCQUE4QixDQUFDLFVBQVUsRUFBRSxLQUFLLENBQUMsQ0FBQTtJQUVqRCxPQUFPLGtEQUFrRCxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUE7QUFDbkUsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLHNCQUFzQixDQUFDLFVBQVU7SUFDeEMsTUFBTSxVQUFVLEdBQUcsVUFBVSxDQUFDLG1DQUFtQyxFQUFFO1FBQ2pFLENBQUMsQ0FBQyxVQUFVLFVBQVUsQ0FBQyxZQUFZLEVBQUUsRUFBRTtRQUN2QyxDQUFDLENBQUMsWUFBWSxVQUFVLENBQUMsK0JBQStCLEVBQUUsRUFBRSxDQUFBO0lBQzlELE1BQU0sUUFBUSxHQUFHLFVBQVUsVUFBVSxFQUFFLENBQUE7SUFDdkMsSUFBSSxVQUFVLEdBQUcsZUFBZSxDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsQ0FBQTtJQUU5QyxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7UUFDaEIsVUFBVSxHQUFHLGdCQUFnQixDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBQ3pDLGVBQWUsQ0FBQyxHQUFHLENBQUMsUUFBUSxFQUFFLFVBQVUsQ0FBQyxDQUFBO0lBQzNDLENBQUM7SUFFRCxPQUFPLFVBQVUsQ0FBQTtBQUNuQixDQUFDO0FBRUQ7Ozs7O0dBS0c7QUFDSCxTQUFTLG1CQUFtQixDQUFDLFVBQVUsRUFBRSxTQUFTO0lBQ2hELE1BQU0sYUFBYSxHQUFHLHVCQUF1QixDQUFDLFVBQVUsQ0FBQyxDQUFBO0lBQ3pELE1BQU0sU0FBUyxHQUFHLFVBQVUsQ0FBQyxZQUFZLEVBQUUsQ0FBQTtJQUMzQyxNQUFNLFFBQVEsR0FBRyxhQUFhLENBQUMsVUFBVSxDQUFDLENBQUE7SUFFMUM7O09BRUc7SUFDSCxNQUFNLFVBQVcsU0FBUSxhQUFhO1FBQ3BDOzs7V0FHRztRQUNILE1BQU0sQ0FBQyxTQUFTO1lBQ2QsT0FBTyxTQUFTLENBQUE7UUFDbEIsQ0FBQztLQUNGO0lBRUQsTUFBTSxDQUFDLGNBQWMsQ0FBQyxVQUFVLEVBQUUsV0FBVyxFQUFFLEVBQUMsS0FBSyxFQUFFLEdBQUcsU0FBUyxPQUFPLEVBQUUsUUFBUSxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7SUFDN0YsOEJBQThCLENBQUMsVUFBVSxFQUFFLFVBQVUsQ0FBQyxDQUFBO0lBQ3RELFVBQVUsQ0FBQyxTQUFTLENBQUMsUUFBUSxFQUFFLEVBQUMsU0FBUyxFQUFFLFNBQVMsRUFBQyxDQUFDLENBQUE7SUFFdEQsT0FBTyxrREFBa0QsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxDQUFBO0FBQ3hFLENBQUM7QUFFRDs7Ozs7R0FLRztBQUNILFNBQVMsOEJBQThCLENBQUMsVUFBVSxFQUFFLFVBQVU7SUFDNUQsVUFBVSxDQUFDLHFCQUFxQixDQUFDLFVBQVUsQ0FBQywrQkFBK0IsRUFBRSxDQUFDLENBQUE7SUFFOUUsSUFBSSxVQUFVLENBQUMsbUNBQW1DLEVBQUUsRUFBRSxDQUFDO1FBQ3JELFVBQVUsQ0FBQyxzQkFBc0IsQ0FBQyxDQUFDLEVBQUMsTUFBTSxFQUFDLEVBQUUsRUFBRSxDQUFDLFVBQVUsQ0FBQywyQkFBMkIsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFBO0lBQ2pHLENBQUM7QUFDSCxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsdUJBQXVCLENBQUMsVUFBVTtJQUN6QyxJQUFJLFdBQVcsR0FBRyxNQUFNLENBQUMsY0FBYyxDQUFDLFVBQVUsQ0FBQyxDQUFBO0lBRW5ELE9BQU8sV0FBVyxJQUFJLE1BQU0sQ0FBQyxjQUFjLENBQUMsV0FBVyxDQUFDLEtBQUssUUFBUSxDQUFDLFNBQVMsRUFBRSxDQUFDO1FBQ2hGLFdBQVcsR0FBRyxNQUFNLENBQUMsY0FBYyxDQUFDLFdBQVcsQ0FBQyxDQUFBO0lBQ2xELENBQUM7SUFFRCxPQUFPLGtEQUFrRCxDQUFDLENBQUMsV0FBVyxDQUFDLENBQUE7QUFDekUsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLGFBQWEsQ0FBQyxVQUFVO0lBQy9CLE1BQU0sSUFBSSxHQUFHLFVBQVUsQ0FBQyxZQUFZLEVBQUUsQ0FBQTtJQUV0QyxPQUFPLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsV0FBVyxFQUFFLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQTtBQUNyRCxDQUFDO0FBRUQsOEVBQThFO0FBQzlFLGlFQUFpRTtBQUNqRSw4RUFBOEU7QUFFOUU7Ozs7OztHQU1HO0FBQ0gsU0FBUyxnQkFBZ0IsQ0FBQyxVQUFVO0lBQ2xDLElBQUksTUFBTSxDQUFDLFNBQVMsQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLFVBQVUsRUFBRSxvQ0FBb0MsQ0FBQyxJQUFJLFVBQVUsQ0FBQyxrQ0FBa0MsRUFBRSxDQUFDO1FBQzVJLE9BQU07SUFDUixDQUFDO0lBRUQsVUFBVSxDQUFDLGtDQUFrQyxHQUFHLElBQUksQ0FBQTtJQUNwRCx5QkFBeUIsQ0FBQyxVQUFVLENBQUMsQ0FBQTtJQUNyQyxVQUFVLENBQUMsWUFBWSxDQUFDLDJCQUEyQixDQUFDLENBQUE7SUFDcEQsVUFBVSxDQUFDLFdBQVcsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFBO0lBQzNDLFVBQVUsQ0FBQyxZQUFZLENBQUMsMkJBQTJCLENBQUMsQ0FBQTtJQUNwRCxVQUFVLENBQUMsV0FBVyxDQUFDLG1CQUFtQixDQUFDLENBQUE7SUFDM0MsVUFBVSxDQUFDLFlBQVksQ0FBQyxvQkFBb0IsQ0FBQyxDQUFBO0FBQy9DLENBQUM7QUFFRDs7Ozs7R0FLRztBQUNILEtBQUssVUFBVSxrQkFBa0IsQ0FBQyxVQUFVLEVBQUUsSUFBSSxHQUFHLEVBQUU7SUFDckQsTUFBTSxFQUFDLGdCQUFnQixHQUFHLEtBQUssRUFBQyxHQUFHLElBQUksQ0FBQTtJQUN2QyxNQUFNLGlCQUFpQixHQUFHLGdDQUFnQyxDQUFDLENBQUMsVUFBVSxDQUFDLENBQUE7SUFFdkUsSUFBSSxDQUFDLGlCQUFpQixDQUFDLGtDQUFrQyxFQUFFLENBQUM7UUFDMUQsT0FBTTtJQUNSLENBQUM7SUFFRCx5QkFBeUIsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFBO0lBRTVDLElBQUksZ0JBQWdCLElBQUksMkJBQTJCLENBQUMsaUJBQWlCLENBQUMsRUFBRSxDQUFDO1FBQ3ZFLE1BQU0scUJBQXFCLENBQUMsaUJBQWlCLENBQUMsQ0FBQTtJQUNoRCxDQUFDO0FBQ0gsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxLQUFLLFVBQVUsbUNBQW1DLENBQUMsYUFBYTtJQUM5RCxNQUFNLFlBQVksR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLGFBQWEsQ0FBQyxlQUFlLEVBQUUsQ0FBQyxDQUFBO0lBQ25FLE1BQU0sc0JBQXNCLEdBQUcsWUFBWSxDQUFDLElBQUksQ0FBQyxDQUFDLFVBQVUsRUFBRSxFQUFFLENBQUMsMkJBQTJCLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQTtJQUV6RyxJQUFJLENBQUMsc0JBQXNCLEVBQUUsQ0FBQztRQUM1QixLQUFLLE1BQU0sVUFBVSxJQUFJLFlBQVksRUFBRSxDQUFDO1lBQ3RDLE1BQU0sa0JBQWtCLENBQUMsVUFBVSxDQUFDLENBQUE7UUFDdEMsQ0FBQztRQUVELE9BQU07SUFDUixDQUFDO0lBRUQsTUFBTSxhQUFhLENBQUMsaUJBQWlCLENBQUMsRUFBQyxJQUFJLEVBQUUsd0NBQXdDLEVBQUMsRUFBRSxLQUFLLElBQUksRUFBRTtRQUNqRyxLQUFLLE1BQU0sVUFBVSxJQUFJLFlBQVksRUFBRSxDQUFDO1lBQ3RDLE1BQU0sa0JBQWtCLENBQUMsVUFBVSxFQUFFLEVBQUMsZ0JBQWdCLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtRQUNoRSxDQUFDO0lBQ0gsQ0FBQyxDQUFDLENBQUE7QUFDSixDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsMkJBQTJCLENBQUMsVUFBVTtJQUM3QyxNQUFNLGlCQUFpQixHQUFHLGdDQUFnQyxDQUFDLENBQUMsVUFBVSxDQUFDLENBQUE7SUFFdkUsSUFBSSxDQUFDLGlCQUFpQixDQUFDLGtDQUFrQyxFQUFFLENBQUM7UUFDMUQsT0FBTyxLQUFLLENBQUE7SUFDZCxDQUFDO0lBRUQsT0FBTyxPQUFPLENBQUMsaUJBQWlCLENBQUMsWUFBWSxDQUFDLElBQUksd0JBQXdCLENBQUMsaUJBQWlCLENBQUMsQ0FBQTtBQUMvRixDQUFDO0FBRUQ7Ozs7OztHQU1HO0FBQ0gsU0FBUyx5QkFBeUIsQ0FBQyxVQUFVLEVBQUUsU0FBUyxHQUFHLGlDQUFpQyxDQUFDLFVBQVUsQ0FBQyxFQUFFLGdCQUFnQjtJQUN4SCxJQUFJLFVBQVUsQ0FBQyxtQkFBbUIsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDO1FBQzdDLE1BQU0sWUFBWSxHQUFHLFVBQVUsQ0FBQyxxQkFBcUIsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUUvRCxJQUFJLDJCQUEyQixDQUFDLEdBQUcsQ0FBQyxZQUFZLENBQUMsSUFBSSxnQkFBZ0IsRUFBRSxDQUFDO1lBQ3RFLG9CQUFvQixDQUFDLFVBQVUsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxnQkFBZ0IsRUFBRSxzQkFBc0IsQ0FBQyxVQUFVLEVBQUUsU0FBUyxDQUFDLENBQUMsQ0FBQTtRQUN2RyxDQUFDO1FBRUQsT0FBTTtJQUNSLENBQUM7SUFFRCxVQUFVLENBQUMsT0FBTyxDQUFDLFFBQVEsRUFBRSxzQkFBc0IsRUFBRTtRQUNuRCxVQUFVLEVBQUUsU0FBUyxDQUFDLFVBQVU7UUFDaEMsS0FBSyxFQUFFLFNBQVMsQ0FBQyxVQUFVO1FBQzNCLFdBQVcsRUFBRSxDQUFDLFNBQVMsQ0FBQyxTQUFTO0tBQ2xDLENBQUMsQ0FBQTtJQUNGLE1BQU0sWUFBWSxHQUFHLFVBQVUsQ0FBQyxxQkFBcUIsQ0FBQyxRQUFRLENBQUMsQ0FBQTtJQUUvRCwyQkFBMkIsQ0FBQyxHQUFHLENBQUMsWUFBWSxDQUFDLENBQUE7SUFDN0MsWUFBWSxDQUFDLGlCQUFpQixDQUFDLENBQUMsTUFBTSxFQUFFLEVBQUU7UUFDeEMsTUFBTSxhQUFhLEdBQUcsb0JBQW9CLENBQUMsVUFBVSxDQUFDLENBQUE7UUFDdEQsTUFBTSxTQUFTLEdBQUcsTUFBTSxDQUFDLGlCQUFpQixFQUFFLENBQUE7UUFFNUMsSUFBSSxTQUFTO1lBQUUsT0FBTyxhQUFhLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDLElBQUksWUFBWSxDQUFBO1FBQ3JGLElBQUksYUFBYSxDQUFDLElBQUksS0FBSyxDQUFDO1lBQUUsT0FBTyxDQUFDLEdBQUcsYUFBYSxDQUFDLE1BQU0sRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUE7UUFFbkUsTUFBTSxRQUFRLEdBQUcscUJBQXFCLENBQUMsVUFBVSxFQUFFLE1BQU0sQ0FBQyxVQUFVLEVBQUUsQ0FBQyxDQUFBO1FBRXZFLE9BQU8sYUFBYSxDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsSUFBSSxZQUFZLENBQUE7SUFDcEQsQ0FBQyxDQUFDLENBQUE7QUFDSixDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsb0JBQW9CLENBQUMsVUFBVTtJQUN0QyxJQUFJLGFBQWEsR0FBRyx5QkFBeUIsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLENBQUE7SUFFN0QsSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDO1FBQ25CLGFBQWEsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFBO1FBQ3pCLHlCQUF5QixDQUFDLEdBQUcsQ0FBQyxVQUFVLEVBQUUsYUFBYSxDQUFDLENBQUE7SUFDMUQsQ0FBQztJQUVELE9BQU8sYUFBYSxDQUFBO0FBQ3RCLENBQUM7QUFFRDs7Ozs7R0FLRztBQUNILFNBQVMsc0JBQXNCLENBQUMsVUFBVSxFQUFFLFNBQVM7SUFDbkQsT0FBTyxJQUFJLG1CQUFtQixDQUFDO1FBQzdCLFVBQVUsRUFBRSxTQUFTLENBQUMsVUFBVTtRQUNoQyxLQUFLLEVBQUUsU0FBUyxDQUFDLFVBQVU7UUFDM0IsVUFBVTtRQUNWLFdBQVcsRUFBRSxDQUFDLFNBQVMsQ0FBQyxTQUFTO1FBQ2pDLGdCQUFnQixFQUFFLFFBQVE7UUFDMUIsS0FBSyxFQUFFLHNCQUFzQjtRQUM3QixJQUFJLEVBQUUsU0FBUztLQUNoQixDQUFDLENBQUE7QUFDSixDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsaUNBQWlDLENBQUMsVUFBVTtJQUNuRCxPQUFPO1FBQ0wsVUFBVSxFQUFFLHNCQUFzQixDQUFDLFVBQVUsQ0FBQztRQUM5QyxTQUFTLEVBQUUsS0FBSztRQUNoQixVQUFVLEVBQUUsY0FBYztRQUMxQixTQUFTLEVBQUUsUUFBUTtLQUNwQixDQUFBO0FBQ0gsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLHNCQUFzQixDQUFDLEtBQUs7SUFDbkMsT0FBTyxLQUFLLENBQUMsS0FBSyxDQUFDLEVBQUMsTUFBTSxFQUFFLFlBQVksRUFBRSxTQUFTLEVBQUUsTUFBTSxFQUFDLENBQUMsQ0FBQTtBQUMvRCxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsd0JBQXdCLENBQUMsVUFBVTtJQUMxQyxJQUFJLENBQUMsVUFBVSxDQUFDLG1DQUFtQyxFQUFFLEVBQUUsQ0FBQztRQUN0RCxPQUFPLElBQUksQ0FBQTtJQUNiLENBQUM7SUFFRCxNQUFNLHdCQUF3QixHQUFHLFVBQVUsQ0FBQywyQkFBMkIsRUFBRSxDQUFBO0lBRXpFLElBQUksQ0FBQyx3QkFBd0IsRUFBRSxDQUFDO1FBQzlCLE9BQU8sS0FBSyxDQUFBO0lBQ2QsQ0FBQztJQUVELE9BQU8sVUFBVSxDQUFDLGlCQUFpQixFQUFFLENBQUMsMEJBQTBCLENBQUMsd0JBQXdCLENBQUMsQ0FBQTtBQUM1RixDQUFDO0FBRUQsOEVBQThFO0FBQzlFLGtCQUFrQjtBQUNsQiw4RUFBOEU7QUFFOUU7Ozs7O0dBS0c7QUFDSCxLQUFLLFVBQVUsV0FBVyxDQUFDLE1BQU0sRUFBRSxJQUFJO0lBQ3JDLE1BQU0sVUFBVSxHQUFHLGdDQUFnQyxDQUFDLENBQUMsTUFBTSxDQUFDLGFBQWEsRUFBRSxDQUFDLENBQUE7SUFDNUUsTUFBTSxTQUFTLEdBQUcsTUFBTSxDQUFDLGlCQUFpQixFQUFFLENBQUE7SUFFNUMsSUFBSSxTQUFTO1FBQUUsT0FBTyxNQUFNLGdDQUFnQyxDQUFDLE1BQU0sRUFBRSxJQUFJLEVBQUUsVUFBVSxDQUFDLENBQUE7SUFFdEYsT0FBTyxNQUFNLFVBQVUsQ0FBQyxpQkFBaUIsRUFBRSxDQUFDLGlCQUFpQixDQUFDLEVBQUMsSUFBSSxFQUFFLEdBQUcsVUFBVSxDQUFDLFlBQVksRUFBRSxRQUFRLEVBQUMsRUFBRSxLQUFLLElBQUksRUFBRTtRQUNySCxPQUFPLE1BQU0sZ0NBQWdDLENBQUMsTUFBTSxFQUFFLElBQUksRUFBRSxVQUFVLENBQUMsQ0FBQTtJQUN6RSxDQUFDLENBQUMsQ0FBQTtBQUNKLENBQUM7QUFFRDs7Ozs7OztHQU9HO0FBQ0gsS0FBSyxVQUFVLGdDQUFnQyxDQUFDLE1BQU0sRUFBRSxJQUFJLEVBQUUsVUFBVTtJQUN0RSxJQUFJLENBQUMsTUFBTSxDQUFDLFdBQVcsRUFBRTtRQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsNEJBQTRCLFVBQVUsQ0FBQyxZQUFZLEVBQUUsU0FBUyxDQUFDLENBQUE7SUFFMUcsTUFBTSxFQUFFLEdBQUcsTUFBTSxDQUFDLFVBQVUsRUFBRSxDQUFBO0lBQzlCLE1BQU0sU0FBUyxHQUFHLE1BQU0scUJBQXFCLENBQUMsVUFBVSxFQUFFLEVBQUUsRUFBRSxNQUFNLENBQUMsaUJBQWlCLEVBQUUsQ0FBQyxDQUFBO0lBQ3pGLE1BQU0sTUFBTSxHQUFHLGVBQWUsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUE7SUFDM0MsTUFBTSxjQUFjLEdBQUcsSUFBSSxDQUFDLGNBQWMsS0FBSyxTQUFTLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQTtJQUNyRixNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsTUFBTSxLQUFLLFNBQVMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFBO0lBQzdELE1BQU0sV0FBVyxHQUFHLElBQUksSUFBSSxFQUFFLENBQUE7SUFDOUIsTUFBTSxRQUFRLEdBQUcsMEJBQTBCLENBQUMsTUFBTSxDQUFDLEVBQUUsRUFBRSxFQUFFLGdCQUFnQixVQUFVLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQTtJQUUzRixNQUFNLGFBQWEsR0FBRyxNQUFNLG9CQUFvQixDQUFDO1FBQy9DLFVBQVUsRUFBRSxRQUFRO1FBQ3BCLFdBQVc7UUFDWCxFQUFFO1FBQ0YsU0FBUyxFQUFFLGVBQWU7UUFDMUIsS0FBSyxFQUFFLE1BQU07S0FDZCxDQUFDLENBQUE7SUFFRixNQUFNLE9BQU8sR0FBRyxJQUFJLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQTtJQUVwQyxJQUFJLFNBQVMsQ0FBQyxTQUFTLEVBQUUsQ0FBQztRQUN4QixNQUFNLFFBQVEsR0FBRyxhQUFhLENBQUMsVUFBVSxDQUFDLENBQUE7UUFFMUMsTUFBTSxFQUFFLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxTQUFTLENBQUM7WUFDMUIsNkJBQTZCLEVBQUUsQ0FBQyxJQUFJLENBQUM7WUFDckMsU0FBUyxFQUFFLFNBQVMsQ0FBQyxTQUFTO1lBQzlCLElBQUksRUFBRTtnQkFDSixFQUFFLEVBQUUsT0FBTztnQkFDWCxDQUFDLEdBQUcsUUFBUSxLQUFLLENBQUMsRUFBRSxRQUFRO2dCQUM1QixlQUFlLEVBQUUsYUFBYTtnQkFDOUIsZUFBZSxFQUFFLGNBQWM7Z0JBQy9CLE1BQU07Z0JBQ04sVUFBVSxFQUFFLFdBQVc7Z0JBQ3ZCLFVBQVUsRUFBRSxXQUFXO2FBQ3hCO1NBQ0YsQ0FBQyxDQUFDLENBQUE7SUFDTCxDQUFDO1NBQU0sQ0FBQztRQUNOLE1BQU0sb0JBQW9CLEdBQUcsTUFBTSxvQkFBb0IsQ0FBQztZQUN0RCxVQUFVLEVBQUUsTUFBTTtZQUNsQixXQUFXO1lBQ1gsRUFBRTtZQUNGLFNBQVMsRUFBRSx1QkFBdUI7WUFDbEMsS0FBSyxFQUFFLFVBQVUsQ0FBQyxZQUFZLEVBQUU7U0FDakMsQ0FBQyxDQUFBO1FBRUYsTUFBTSxFQUFFLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxTQUFTLENBQUM7WUFDMUIsNkJBQTZCLEVBQUUsQ0FBQyxJQUFJLENBQUM7WUFDckMsU0FBUyxFQUFFLFFBQVE7WUFDbkIsSUFBSSxFQUFFO2dCQUNKLEVBQUUsRUFBRSxPQUFPO2dCQUNYLGVBQWUsRUFBRSxhQUFhO2dCQUM5Qix1QkFBdUIsRUFBRSxvQkFBb0I7Z0JBQzdDLFlBQVksRUFBRSxRQUFRO2dCQUN0QixjQUFjLEVBQUUsVUFBVSxDQUFDLFlBQVksRUFBRTtnQkFDekMsZUFBZSxFQUFFLGNBQWM7Z0JBQy9CLE1BQU07Z0JBQ04sVUFBVSxFQUFFLFdBQVc7Z0JBQ3ZCLFVBQVUsRUFBRSxXQUFXO2FBQ3hCO1NBQ0YsQ0FBQyxDQUFDLENBQUE7SUFDTCxDQUFDO0lBRUQsTUFBTSxjQUFjLENBQUMsVUFBVSxFQUFFLE1BQU0sRUFBRTtRQUN2QyxNQUFNO1FBQ04sT0FBTztRQUNQLGNBQWM7UUFDZCxNQUFNO1FBQ04sTUFBTTtLQUNQLENBQUMsQ0FBQTtJQUVGLFdBQVcsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLFlBQVksRUFBRSxFQUFFLE1BQU0sRUFBRTtRQUNsRCxNQUFNO1FBQ04sT0FBTztRQUNQLGNBQWM7UUFDZCxNQUFNO1FBQ04sTUFBTTtLQUNQLENBQUMsQ0FBQTtJQUVGLE9BQU8sT0FBTyxDQUFBO0FBQ2hCLENBQUM7QUFFRCw4RUFBOEU7QUFDOUUsc0JBQXNCO0FBQ3RCLDhFQUE4RTtBQUU5RTs7OztHQUlHO0FBQ0gsU0FBUyx5QkFBeUIsQ0FBQyxNQUFNO0lBQ3ZDLE1BQU0sQ0FBQywwQkFBMEIsR0FBRyw2QkFBNkIsQ0FBQyxNQUFNLENBQUMsQ0FBQTtBQUMzRSxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILEtBQUssVUFBVSxpQkFBaUIsQ0FBQyxNQUFNO0lBQ3JDLE1BQU0sV0FBVyxDQUFDLE1BQU0sRUFBRTtRQUN4QixNQUFNLEVBQUUsUUFBUTtRQUNoQixjQUFjLEVBQUUsTUFBTSxDQUFDLDBCQUEwQixJQUFJLElBQUk7S0FDMUQsQ0FBQyxDQUFBO0lBRUYsTUFBTSxDQUFDLDBCQUEwQixHQUFHLFNBQVMsQ0FBQTtBQUMvQyxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMseUJBQXlCLENBQUMsTUFBTTtJQUN2QyxNQUFNLENBQUMsMEJBQTBCLEdBQUcsNkJBQTZCLENBQUMsTUFBTSxDQUFDLENBQUE7QUFDM0UsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxLQUFLLFVBQVUsaUJBQWlCLENBQUMsTUFBTTtJQUNyQyxNQUFNLGNBQWMsR0FBRyxNQUFNLENBQUMsMEJBQTBCLElBQUksSUFBSSxDQUFBO0lBRWhFLE1BQU0sQ0FBQywwQkFBMEIsR0FBRyxTQUFTLENBQUE7SUFFN0MsSUFBSSxDQUFDLGNBQWMsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxDQUFDLE1BQU0sSUFBSSxDQUFDO1FBQUUsT0FBTTtJQUV0RSxNQUFNLFdBQVcsQ0FBQyxNQUFNLEVBQUU7UUFDeEIsTUFBTSxFQUFFLFFBQVE7UUFDaEIsY0FBYztLQUNmLENBQUMsQ0FBQTtBQUNKLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsS0FBSyxVQUFVLGtCQUFrQixDQUFDLE1BQU07SUFDdEMsTUFBTSxXQUFXLENBQUMsTUFBTSxFQUFFO1FBQ3hCLE1BQU0sRUFBRSxTQUFTO1FBQ2pCLGNBQWMsRUFBRSxzQkFBc0IsQ0FBQyxNQUFNLENBQUM7S0FDL0MsQ0FBQyxDQUFBO0FBQ0osQ0FBQztBQUVELDhFQUE4RTtBQUM5RSxrQkFBa0I7QUFDbEIsOEVBQThFO0FBRTlFOzs7O0dBSUc7QUFDSCxTQUFTLDZCQUE2QixDQUFDLE1BQU07SUFDM0MsTUFBTSxPQUFPLEdBQUcsTUFBTSxDQUFDLE9BQU8sRUFBRSxDQUFBO0lBQ2hDLDJCQUEyQjtJQUMzQixNQUFNLGNBQWMsR0FBRyxFQUFFLENBQUE7SUFDekIsTUFBTSx5QkFBeUIsR0FBRyxNQUFNLENBQUMsYUFBYSxFQUFFLENBQUMsK0JBQStCLEVBQUUsQ0FBQTtJQUUxRixLQUFLLE1BQU0sQ0FBQyxhQUFhLEVBQUUsTUFBTSxDQUFDLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1FBQzlELGNBQWMsQ0FBQyx5QkFBeUIsQ0FBQyxhQUFhLENBQUMsSUFBSSxhQUFhLENBQUMsR0FBRyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUE7SUFDdkYsQ0FBQztJQUVELE9BQU8sY0FBYyxDQUFBO0FBQ3ZCLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBUyxzQkFBc0IsQ0FBQyxNQUFNO0lBQ3BDLE9BQU8sRUFBQyxHQUFHLE1BQU0sQ0FBQyxVQUFVLEVBQUUsRUFBQyxDQUFBO0FBQ2pDLENBQUM7QUFFRCw4RUFBOEU7QUFDOUUsZUFBZTtBQUNmLDhFQUE4RTtBQUU5RTs7Ozs7Ozs7R0FRRztBQUNILFNBQVMsWUFBWSxDQUFDLFVBQVUsRUFBRSxNQUFNO0lBQ3RDLE1BQU0sRUFBRSxHQUFHLFVBQVUsQ0FBQyxVQUFVLEVBQUUsQ0FBQTtJQUNsQyxNQUFNLGdCQUFnQixHQUFHLHFCQUFxQixDQUFDLFVBQVUsRUFBRSxFQUFFLENBQUMsQ0FBQTtJQUM5RCxNQUFNLFNBQVMsR0FBRyxxQkFBcUIsQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDLEVBQUUsR0FBRyxDQUFDLGdCQUFnQixDQUFDLENBQUE7SUFDOUUsTUFBTSxhQUFhLEdBQUcsRUFBRSxDQUFDLFVBQVUsQ0FBQyxVQUFVLENBQUMsU0FBUyxFQUFFLENBQUMsQ0FBQTtJQUMzRCxNQUFNLG9CQUFvQixHQUFHLEVBQUUsQ0FBQyxVQUFVLENBQUMsZUFBZSxDQUFDLENBQUE7SUFDM0QsTUFBTSxVQUFVLEdBQUcscUJBQXFCLENBQUMsVUFBVSxDQUFDLFVBQVUsRUFBRSxFQUFFLG9CQUFvQixVQUFVLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQTtJQUN4RyxNQUFNLGtCQUFrQixHQUFHLEdBQUcsYUFBYSxJQUFJLEVBQUUsQ0FBQyxXQUFXLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQTtJQUMzRSxNQUFNLGlCQUFpQixHQUFHLEdBQUcsb0JBQW9CLElBQUksRUFBRSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFBO0lBQzNFLE1BQU0scUJBQXFCLEdBQUcsR0FBRyxvQkFBb0IsSUFBSSxFQUFFLENBQUMsV0FBVyxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUE7SUFFbkYsSUFBSSxTQUFTLEVBQUUsU0FBUyxFQUFFLENBQUM7UUFDekIsTUFBTSxRQUFRLEdBQUcsYUFBYSxDQUFDLFVBQVUsQ0FBQyxDQUFBO1FBQzFDLE1BQU0sY0FBYyxHQUFHLEVBQUUsQ0FBQyxVQUFVLENBQUMsU0FBUyxDQUFDLFNBQVMsQ0FBQyxDQUFBO1FBQ3pELE1BQU0sZ0JBQWdCLEdBQUcsR0FBRyxjQUFjLElBQUksRUFBRSxDQUFDLFdBQVcsQ0FBQyxpQkFBaUIsQ0FBQyxFQUFFLENBQUE7UUFDakYsTUFBTSxVQUFVLEdBQUcsR0FBRyxjQUFjLElBQUksRUFBRSxDQUFDLFdBQVcsQ0FBQyxHQUFHLFFBQVEsS0FBSyxDQUFDLEVBQUUsQ0FBQTtRQUUxRSxPQUFPLFVBQVU7YUFDZCxHQUFHLEVBQUU7YUFDTCxLQUFLLENBQUM7OztpQkFHSSxjQUFjO3VCQUNSLG9CQUFvQjtpQkFDMUIsaUJBQWlCLE1BQU0sZ0JBQWdCO2tCQUN0QyxVQUFVLE1BQU0sa0JBQWtCO2tCQUNsQyxxQkFBcUIsTUFBTSxFQUFFLENBQUMsS0FBSyxDQUFDLGVBQWUsQ0FBQyxNQUFNLENBQUMsQ0FBQzs7T0FFdkUsQ0FBQyxDQUFBO0lBQ04sQ0FBQztJQUVELE1BQU0sY0FBYyxHQUFHLEVBQUUsQ0FBQyxVQUFVLENBQUMsUUFBUSxDQUFDLENBQUE7SUFDOUMsTUFBTSxtQkFBbUIsR0FBRyxHQUFHLGNBQWMsSUFBSSxFQUFFLENBQUMsV0FBVyxDQUFDLGNBQWMsQ0FBQyxFQUFFLENBQUE7SUFDakYsTUFBTSxxQkFBcUIsR0FBRyxHQUFHLGNBQWMsSUFBSSxFQUFFLENBQUMsV0FBVyxDQUFDLGdCQUFnQixDQUFDLEVBQUUsQ0FBQTtJQUNyRixNQUFNLGdCQUFnQixHQUFHLEdBQUcsY0FBYyxJQUFJLEVBQUUsQ0FBQyxXQUFXLENBQUMsaUJBQWlCLENBQUMsRUFBRSxDQUFBO0lBRWpGLE9BQU8sVUFBVTtTQUNkLEdBQUcsRUFBRTtTQUNMLEtBQUssQ0FBQzs7O2VBR0ksY0FBYztxQkFDUixvQkFBb0I7ZUFDMUIsaUJBQWlCLE1BQU0sZ0JBQWdCO2dCQUN0QyxxQkFBcUIsTUFBTSxFQUFFLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxZQUFZLEVBQUUsQ0FBQztnQkFDOUQsbUJBQW1CLE1BQU0sa0JBQWtCO2dCQUMzQyxxQkFBcUIsTUFBTSxFQUFFLENBQUMsS0FBSyxDQUFDLGVBQWUsQ0FBQyxNQUFNLENBQUMsQ0FBQzs7S0FFdkUsQ0FBQyxDQUFBO0FBQ04sQ0FBQztBQUVELDhFQUE4RTtBQUM5RSxrQkFBa0I7QUFDbEIsOEVBQThFO0FBRTlFOzs7Ozs7R0FNRztBQUNILFNBQVMscUJBQXFCLENBQUMsVUFBVSxFQUFFLE1BQU0sRUFBRSxRQUFRO0lBQ3pELE1BQU0sZ0JBQWdCLEdBQUcsZUFBZSxDQUFDLE1BQU0sQ0FBQyxDQUFBO0lBQ2hELE1BQU0sU0FBUyxHQUFHLDJCQUEyQixDQUFDLFVBQVUsQ0FBQyxDQUFBO0lBRXpELElBQUksQ0FBQyxTQUFTLENBQUMsZ0JBQWdCLENBQUMsRUFBRSxDQUFDO1FBQ2pDLFNBQVMsQ0FBQyxnQkFBZ0IsQ0FBQyxHQUFHLEVBQUUsQ0FBQTtJQUNsQyxDQUFDO0lBRUQsU0FBUyxDQUFDLGdCQUFnQixDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFBO0lBRTFDLE9BQU8sR0FBRyxFQUFFO1FBQ1YsTUFBTSxlQUFlLEdBQUcsU0FBUyxDQUFDLGdCQUFnQixDQUFDLENBQUE7UUFDbkQsTUFBTSxLQUFLLEdBQUcsZUFBZSxDQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUUvQyxJQUFJLEtBQUssSUFBSSxDQUFDLEVBQUUsQ0FBQztZQUNmLGVBQWUsQ0FBQyxNQUFNLENBQUMsS0FBSyxFQUFFLENBQUMsQ0FBQyxDQUFBO1FBQ2xDLENBQUM7SUFDSCxDQUFDLENBQUE7QUFDSCxDQUFDO0FBRUQ7Ozs7OztHQU1HO0FBQ0gsS0FBSyxVQUFVLGNBQWMsQ0FBQyxVQUFVLEVBQUUsTUFBTSxFQUFFLE9BQU87SUFDdkQsTUFBTSxTQUFTLEdBQUcsMkJBQTJCLENBQUMsVUFBVSxDQUFDLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxDQUFBO0lBRXZFLEtBQUssTUFBTSxRQUFRLElBQUksQ0FBQyxHQUFHLFNBQVMsQ0FBQyxFQUFFLENBQUM7UUFDdEMsTUFBTSxRQUFRLENBQUMsT0FBTyxDQUFDLENBQUE7SUFDekIsQ0FBQztBQUNILENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBUywyQkFBMkIsQ0FBQyxVQUFVO0lBQzdDLElBQUksQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsVUFBVSxFQUFFLGlCQUFpQixDQUFDLEVBQUUsQ0FBQztRQUN6RSxVQUFVLENBQUMsZUFBZSxHQUFHLEVBQUUsQ0FBQTtJQUNqQyxDQUFDO0lBRUQsTUFBTSxTQUFTLEdBQUcsVUFBVSxDQUFDLGVBQWUsQ0FBQTtJQUU1QyxJQUFJLENBQUMsU0FBUztRQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsMkNBQTJDLFVBQVUsQ0FBQyxZQUFZLEVBQUUsRUFBRSxDQUFDLENBQUE7SUFFdkcsT0FBTyxTQUFTLENBQUE7QUFDbEIsQ0FBQztBQUVELDhFQUE4RTtBQUM5RSxpQkFBaUI7QUFDakIsOEVBQThFO0FBRTlFOzs7Ozs7Ozs7R0FTRztBQUNILEtBQUssVUFBVSxvQkFBb0IsQ0FBQyxFQUFDLFVBQVUsRUFBRSxXQUFXLEVBQUUsRUFBRSxFQUFFLFNBQVMsRUFBRSxLQUFLLEVBQUM7SUFDakYsTUFBTSxFQUFFLENBQUMsTUFBTSxDQUFDO1FBQ2QsU0FBUztRQUNULGVBQWUsRUFBRSxDQUFDLFVBQVUsQ0FBQztRQUM3QixhQUFhLEVBQUUsQ0FBQyxVQUFVLENBQUM7UUFDM0IsSUFBSSxFQUFFO1lBQ0osRUFBRSxFQUFFLElBQUksSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sRUFBRTtZQUN4QixDQUFDLFVBQVUsQ0FBQyxFQUFFLEtBQUs7WUFDbkIsVUFBVSxFQUFFLFdBQVc7WUFDdkIsVUFBVSxFQUFFLFdBQVc7U0FDeEI7S0FDRixDQUFDLENBQUE7SUFFRixNQUFNLEVBQUUsR0FBRyxNQUFNLFlBQVksQ0FBQyxFQUFDLFVBQVUsRUFBRSxFQUFFLEVBQUUsU0FBUyxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7SUFFakUsSUFBSSxFQUFFLEtBQUssSUFBSTtRQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsaUJBQWlCLFNBQVMsSUFBSSxVQUFVLGVBQWUsQ0FBQyxDQUFBO0lBRXpGLE9BQU8sRUFBRSxDQUFBO0FBQ1gsQ0FBQztBQUVEOzs7Ozs7OztHQVFHO0FBQ0gsS0FBSyxVQUFVLFlBQVksQ0FBQyxFQUFDLFVBQVUsRUFBRSxFQUFFLEVBQUUsU0FBUyxFQUFFLEtBQUssRUFBQztJQUM1RCxNQUFNLElBQUksR0FBRywyQ0FBMkMsQ0FBQyxDQUFDLE1BQU0sRUFBRSxDQUFDLEtBQUssQ0FBQzthQUM5RCxFQUFFLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQztXQUN0QixFQUFFLENBQUMsVUFBVSxDQUFDLFNBQVMsQ0FBQztZQUN2QixFQUFFLENBQUMsV0FBVyxDQUFDLFVBQVUsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDO0dBQ3hELENBQUMsQ0FBQyxDQUFBO0lBRUgsSUFBSSxJQUFJLENBQUMsQ0FBQyxDQUFDO1FBQUUsT0FBTyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFBO0lBRTlCLE9BQU8sSUFBSSxDQUFBO0FBQ2IsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLGVBQWUsQ0FBQyxNQUFNO0lBQzdCLE1BQU0sZ0JBQWdCLEdBQUcsTUFBTSxDQUFDLElBQUksRUFBRSxDQUFBO0lBRXRDLElBQUksQ0FBQyxnQkFBZ0I7UUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLDhCQUE4QixDQUFDLENBQUE7SUFFdEUsT0FBTyxnQkFBZ0IsQ0FBQTtBQUN6QixDQUFDO0FBRUQsOEVBQThFO0FBQzlFLG9CQUFvQjtBQUNwQiw4RUFBOEU7QUFFOUU7Ozs7O0dBS0c7QUFDSCxTQUFTLGdDQUFnQyxDQUFDLE9BQU8sR0FBRyxFQUFFO0lBQ3BELE1BQU0sSUFBSSxHQUFHLG9DQUFvQyxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUE7SUFDM0QsTUFBTSxTQUFTLEdBQUcsOEJBQThCLENBQUMsQ0FBQyxJQUFJLENBQUMsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFBO0lBQ2hFLE1BQU0sSUFBSSxHQUFHLFNBQVMsQ0FBQyxJQUFJLENBQUE7SUFFM0IsT0FBTztRQUNMLEtBQUssQ0FBQyxFQUFFLENBQUMsS0FBSztZQUNaLE1BQU0sS0FBSyxDQUFDLFdBQVcsQ0FBQyxlQUFlLEVBQUUsRUFBQyxFQUFFLEVBQUUsOEJBQThCLENBQUMsQ0FBQyxJQUFJLENBQUMsRUFBRSxJQUFJLEVBQUUsQ0FBQyxFQUFDLEVBQUUsQ0FBQyxpR0FBaUcsQ0FBQyxDQUFDLEVBQUUsRUFBRTtnQkFDck0sQ0FBQyxDQUFDLE1BQU0sQ0FBQyxRQUFRLEVBQUUsRUFBQyxLQUFLLEVBQUUsRUFBQyxNQUFNLEVBQUUsSUFBSSxFQUFDLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBQyxDQUFDLENBQUE7Z0JBQ3hELENBQUMsQ0FBQyxVQUFVLEVBQUUsQ0FBQTtZQUNoQixDQUFDLENBQUMsQ0FBQTtZQUVGLE1BQU0sS0FBSyxDQUFDLFdBQVcsQ0FBQyx1QkFBdUIsRUFBRSxFQUFDLEVBQUUsRUFBRSw4QkFBOEIsQ0FBQyxDQUFDLElBQUksQ0FBQyxFQUFFLElBQUksRUFBRSxDQUFDLEVBQUMsRUFBRSxDQUFDLGlHQUFpRyxDQUFDLENBQUMsRUFBRSxFQUFFO2dCQUM3TSxDQUFDLENBQUMsTUFBTSxDQUFDLE1BQU0sRUFBRSxFQUFDLEtBQUssRUFBRSxFQUFDLE1BQU0sRUFBRSxJQUFJLEVBQUMsRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFDLENBQUMsQ0FBQTtnQkFDdEQsQ0FBQyxDQUFDLFVBQVUsRUFBRSxDQUFBO1lBQ2hCLENBQUMsQ0FBQyxDQUFBO1lBRUYsTUFBTSxLQUFLLENBQUMsV0FBVyxDQUFDLFFBQVEsRUFBRSxFQUFDLEVBQUUsRUFBRSw4QkFBOEIsQ0FBQyxDQUFDLElBQUksQ0FBQyxFQUFFLElBQUksRUFBRSxDQUFDLEVBQUMsRUFBRSxDQUFDLCtIQUErSCxDQUFDLENBQUMsRUFBRSxFQUFFO2dCQUM1TixDQUFDLENBQUMsVUFBVSxDQUFDLGNBQWMsRUFBRSxFQUFDLFVBQVUsRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFBO2dCQUNuRSxDQUFDLENBQUMsVUFBVSxDQUFDLHNCQUFzQixFQUFFLEVBQUMsVUFBVSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7Z0JBQzNFLENBQUMsQ0FBQyxVQUFVLENBQUMsV0FBVyxFQUFFLEVBQUMsSUFBSSxFQUFFLEtBQUssRUFBRSxXQUFXLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUE7Z0JBQ2pFLENBQUMsQ0FBQyxJQUFJLENBQUMsaUJBQWlCLENBQUMsQ0FBQTtnQkFDekIsQ0FBQyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQTtnQkFDaEIsQ0FBQyxDQUFDLFVBQVUsRUFBRSxDQUFBO1lBQ2hCLENBQUMsQ0FBQyxDQUFBO1FBQ0osQ0FBQztRQUVELEtBQUssQ0FBQyxJQUFJLENBQUMsS0FBSztZQUNkLE1BQU0sS0FBSyxDQUFDLFNBQVMsQ0FBQyxRQUFRLENBQUMsQ0FBQTtZQUMvQixNQUFNLEtBQUssQ0FBQyxTQUFTLENBQUMsdUJBQXVCLENBQUMsQ0FBQTtZQUM5QyxNQUFNLEtBQUssQ0FBQyxTQUFTLENBQUMsZUFBZSxDQUFDLENBQUE7UUFDeEMsQ0FBQztLQUNGLENBQUE7QUFDSCxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsK0JBQStCLENBQUMsY0FBYztJQUNyRCxJQUFJLGNBQWMsQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUNqQyxPQUFPLEdBQUcsY0FBYyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFBO0lBQ2hELENBQUM7SUFFRCxPQUFPLEdBQUcsY0FBYyxTQUFTLENBQUE7QUFDbkMsQ0FBQztBQUVELE9BQU8sRUFDTCxXQUFXLEVBQ1gseUJBQXlCLEVBQ3pCLHlCQUF5QixFQUN6QixXQUFXLEVBQ1gsaUJBQWlCLEVBQ2pCLGtCQUFrQixFQUNsQixpQkFBaUIsRUFDakIsZ0NBQWdDLEVBQ2hDLCtCQUErQixFQUMvQixtQ0FBbUMsRUFDbkMsa0JBQWtCLEVBQ2xCLHFCQUFxQixFQUNyQixnQkFBZ0IsRUFDaEIsWUFBWSxFQUNiLENBQUEiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IFVVSUQgZnJvbSBcInB1cmUtdXVpZFwiXG5pbXBvcnQgSGFzTWFueVJlbGF0aW9uc2hpcCBmcm9tIFwiLi9yZWxhdGlvbnNoaXBzL2hhcy1tYW55LmpzXCJcbmltcG9ydCB7c2NhbGFyTW9kZWxQcmltYXJ5S2V5LCBzY2FsYXJNb2RlbFByaW1hcnlLZXlWYWx1ZX0gZnJvbSBcIi4uLy4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCJcblxuLyoqXG4gKiBHbG9iYWwgYXVkaXQgZXZlbnQgYnVzIG1hdGNoaW5nIEFjdGl2ZVJlY29yZEF1ZGl0YWJsZTo6RXZlbnRzLlxuICogQHR5cGVkZWYge29iamVjdH0gQXVkaXRFdmVudHNUeXBlXG4gKiBAcHJvcGVydHkgeyh0eXBlOiBzdHJpbmcsIGFjdGlvbjogc3RyaW5nLCBhcmdzOiBBdWRpdEV2ZW50UGF5bG9hZCkgPT4gdm9pZH0gY2FsbCAtIEZpcmUgYWxsIGNhbGxiYWNrcyBmb3IgYSBtb2RlbCB0eXBlICsgYWN0aW9uLlxuICogQHByb3BlcnR5IHsodHlwZTogc3RyaW5nLCBhY3Rpb246IHN0cmluZywgY2FsbGJhY2s6IChhcmdzOiBBdWRpdEV2ZW50UGF5bG9hZCkgPT4gdm9pZCkgPT4gKCkgPT4gdm9pZH0gY29ubmVjdCAtIFJlZ2lzdGVyIGEgY2FsbGJhY2sgZm9yIGEgbW9kZWwgdHlwZSArIGFjdGlvbi4gUmV0dXJucyBhbiB1bnN1YnNjcmliZSBmdW5jdGlvbi5cbiAqIEBwcm9wZXJ0eSB7KCkgPT4gdm9pZH0gcmVzZXQgLSBDbGVhciBhbGwgcmVnaXN0ZXJlZCBjYWxsYmFja3MuXG4gKi9cbi8qKlxuICogQXVkaXRDaGFuZ2VzIHR5cGUuXG4gKiBAdHlwZWRlZiB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSBBdWRpdENoYW5nZXNcbiAqL1xuXG4vKipcbiAqIEF1ZGl0RXZlbnRQYXlsb2FkIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBBdWRpdEV2ZW50UGF5bG9hZFxuICogQHByb3BlcnR5IHtzdHJpbmd9IGFjdGlvbiAtIEF1ZGl0IGFjdGlvbiBuYW1lLlxuICogQHByb3BlcnR5IHtudW1iZXIgfCBzdHJpbmd9IGF1ZGl0SWQgLSBDcmVhdGVkIGF1ZGl0IHJvdyBpZC5cbiAqIEBwcm9wZXJ0eSB7QXVkaXRDaGFuZ2VzIHwgbnVsbH0gYXVkaXRlZENoYW5nZXMgLSBDaGFuZ2VzIGNhcHR1cmVkIGZvciB0aGUgYXVkaXQuXG4gKiBAcHJvcGVydHkge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+PiB8IG51bGx9IHBhcmFtcyAtIE9wdGlvbmFsIGNhbGxlci1zdXBwbGllZCBhdWRpdCBwYXJhbXMuXG4gKiBAcHJvcGVydHkge2ltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gcmVjb3JkIC0gQXVkaXRlZCByZWNvcmQuXG4gKi9cblxuLyoqXG4gKiBBdWRpdENhbGxiYWNrIHR5cGUuXG4gKiBAdHlwZWRlZiB7KHBheWxvYWQ6IEF1ZGl0RXZlbnRQYXlsb2FkKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPn0gQXVkaXRDYWxsYmFja1xuICovXG5cbi8qKlxuICogQ3JlYXRlQXVkaXRBcmdzIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBDcmVhdGVBdWRpdEFyZ3NcbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBhY3Rpb24gLSBBdWRpdCBhY3Rpb24gbmFtZS5cbiAqIEBwcm9wZXJ0eSB7QXVkaXRDaGFuZ2VzIHwgbnVsbH0gW2F1ZGl0ZWRDaGFuZ2VzXSAtIEV4cGxpY2l0IGNoYW5nZXMgdG8gcGVyc2lzdC5cbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbH0gW3BhcmFtc10gLSBPcHRpb25hbCBtZXRhZGF0YSB0byBzdG9yZSB3aXRoIHRoZSBhdWRpdC5cbiAqL1xuXG4vKipcbiAqIEF1ZGl0ZWRNb2RlbENsYXNzIHR5cGUuXG4gKiBAdHlwZWRlZiB7dHlwZW9mIGltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdCAmIHtcbiAqICAgX2F1ZGl0Q2FsbGJhY2tzPzogUmVjb3JkPHN0cmluZywgQXVkaXRDYWxsYmFja1tdPixcbiAqICAgX2F1ZGl0TGlmZWN5Y2xlQ2FsbGJhY2tzUmVnaXN0ZXJlZD86IGJvb2xlYW4sXG4gKiAgIF9hdWRpdFRhYmxlUmVzb2x2ZWQ/OiBib29sZWFuLFxuICogICBfYXVkaXRUYWJsZURhdGE/OiBBdWRpdFRhYmxlRGF0YVxuICogfX0gQXVkaXRlZE1vZGVsQ2xhc3NcbiAqL1xuXG4vKipcbiAqIEF1ZGl0VGFibGVEYXRhIHR5cGUuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBBdWRpdFRhYmxlRGF0YVxuICogQHByb3BlcnR5IHtib29sZWFufSBkZWRpY2F0ZWQgLSBXaGV0aGVyIGEgZGVkaWNhdGVkIGF1ZGl0IHRhYmxlIGV4aXN0cy5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBOYW1lIG9mIHRoZSBhdWRpdCB0YWJsZS5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBmb3JlaWduS2V5IC0gQ29sdW1uIG5hbWUgdGhhdCByZWZlcmVuY2VzIHRoZSBhdWRpdGVkIG1vZGVsLlxuICogQHByb3BlcnR5IHt0eXBlb2YgaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBhdWRpdENsYXNzIC0gVGhlIGF1ZGl0IG1vZGVsIGNsYXNzIHRvIHVzZS5cbiAqL1xuXG4vKiogQHR5cGUge1dlYWtNYXA8aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0LCBNYXA8c3RyaW5nLCBib29sZWFuPj59ICovXG5jb25zdCBkZWRpY2F0ZWRUYWJsZUNhY2hlQnlDb25maWd1cmF0aW9uID0gbmV3IFdlYWtNYXAoKVxuXG4vKiogQHR5cGUge1dlYWtNYXA8QXVkaXRlZE1vZGVsQ2xhc3MsIE1hcDxzdHJpbmcsIEF1ZGl0VGFibGVEYXRhPj59ICovXG5jb25zdCBhdWRpdFRhYmxlRGF0YUJ5TW9kZWwgPSBuZXcgV2Vha01hcCgpXG5cbi8qKiBAdHlwZSB7TWFwPHN0cmluZywgdHlwZW9mIGltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdD59ICovXG5jb25zdCBhdWRpdENsYXNzQ2FjaGUgPSBuZXcgTWFwKClcblxuY29uc3QgZ2VuZXJhdGVkQXVkaXRSZWxhdGlvbnNoaXBzID0gbmV3IFdlYWtTZXQoKVxuXG4vKiogQHR5cGUge1dlYWtNYXA8QXVkaXRlZE1vZGVsQ2xhc3MsIE1hcDxzdHJpbmcsIEhhc01hbnlSZWxhdGlvbnNoaXA+Pn0gKi9cbmNvbnN0IGF1ZGl0UmVsYXRpb25zaGlwc0J5TW9kZWwgPSBuZXcgV2Vha01hcCgpXG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gR2xvYmFsIGV2ZW50IGJ1cyAobGlrZSBBY3RpdmVSZWNvcmRBdWRpdGFibGU6OkV2ZW50cylcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJlY29yZDxzdHJpbmcsIEFycmF5PChhcmdzOiBBdWRpdEV2ZW50UGF5bG9hZCkgPT4gdm9pZD4+Pn0gKi9cbmxldCBnbG9iYWxFdmVudENvbm5lY3Rpb25zID0ge31cblxuLyoqIEB0eXBlIHtBdWRpdEV2ZW50c1R5cGV9ICovXG5jb25zdCBBdWRpdEV2ZW50cyA9IHtcbiAgLyoqXG4gICAqIEZpcmUgYWxsIHJlZ2lzdGVyZWQgY2FsbGJhY2tzIGZvciBhIG1vZGVsIHR5cGUgYW5kIGFjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHR5cGUgLSBBdWRpdGVkIG1vZGVsIHR5cGUgd2hvc2UgbGlzdGVuZXJzIHNob3VsZCBmaXJlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYWN0aW9uIC0gQXVkaXQgYWN0aW9uIHdob3NlIGxpc3RlbmVycyBzaG91bGQgZmlyZS5cbiAgICogQHBhcmFtIHtBdWRpdEV2ZW50UGF5bG9hZH0gYXJncyAtIEF1ZGl0IGV2ZW50IGRlbGl2ZXJlZCB0byBtYXRjaGluZyBsaXN0ZW5lcnMuXG4gICAqL1xuICBjYWxsKHR5cGUsIGFjdGlvbiwgYXJncykge1xuICAgIGNvbnN0IGFjdGlvbnMgPSBnbG9iYWxFdmVudENvbm5lY3Rpb25zW3R5cGVdIHx8IHt9XG4gICAgY29uc3QgY2FsbGJhY2tzID0gYWN0aW9uc1thY3Rpb25dIHx8IFtdXG5cbiAgICBmb3IgKGNvbnN0IGNhbGxiYWNrIG9mIFsuLi5jYWxsYmFja3NdKSB7XG4gICAgICBjYWxsYmFjayhhcmdzKVxuICAgIH1cbiAgfSxcblxuICAvKipcbiAgICogUmVnaXN0ZXIgYSBjYWxsYmFjayBmb3IgYSBtb2RlbCB0eXBlIGFuZCBhY3Rpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB0eXBlIC0gQXVkaXRlZCBtb2RlbCB0eXBlIHRvIG9ic2VydmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhY3Rpb24gLSBBdWRpdCBhY3Rpb24gdG8gb2JzZXJ2ZS5cbiAgICogQHBhcmFtIHsoYXJnczogQXVkaXRFdmVudFBheWxvYWQpID0+IHZvaWR9IGNhbGxiYWNrIC0gTGlzdGVuZXIgaW52b2tlZCBmb3IgbWF0Y2hpbmcgYXVkaXQgZXZlbnRzLlxuICAgKiBAcmV0dXJucyB7KCkgPT4gdm9pZH0gLSBDYWxsYmFjayB0aGF0IHJlbW92ZXMgdGhlIHJlZ2lzdHJhdGlvbi5cbiAgICovXG4gIGNvbm5lY3QodHlwZSwgYWN0aW9uLCBjYWxsYmFjaykge1xuICAgIGlmICghZ2xvYmFsRXZlbnRDb25uZWN0aW9uc1t0eXBlXSkge1xuICAgICAgZ2xvYmFsRXZlbnRDb25uZWN0aW9uc1t0eXBlXSA9IHt9XG4gICAgfVxuXG4gICAgaWYgKCFnbG9iYWxFdmVudENvbm5lY3Rpb25zW3R5cGVdW2FjdGlvbl0pIHtcbiAgICAgIGdsb2JhbEV2ZW50Q29ubmVjdGlvbnNbdHlwZV1bYWN0aW9uXSA9IFtdXG4gICAgfVxuXG4gICAgZ2xvYmFsRXZlbnRDb25uZWN0aW9uc1t0eXBlXVthY3Rpb25dLnB1c2goY2FsbGJhY2spXG5cbiAgICByZXR1cm4gKCkgPT4ge1xuICAgICAgY29uc3QgbGlzdCA9IGdsb2JhbEV2ZW50Q29ubmVjdGlvbnNbdHlwZV0/LlthY3Rpb25dXG5cbiAgICAgIGlmIChsaXN0KSB7XG4gICAgICAgIGNvbnN0IGluZGV4ID0gbGlzdC5pbmRleE9mKGNhbGxiYWNrKVxuXG4gICAgICAgIGlmIChpbmRleCA+PSAwKSB7XG4gICAgICAgICAgbGlzdC5zcGxpY2UoaW5kZXgsIDEpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH0sXG5cbiAgLyoqIENsZWFyIGFsbCByZWdpc3RlcmVkIGNhbGxiYWNrcy4gKi9cbiAgcmVzZXQoKSB7XG4gICAgZ2xvYmFsRXZlbnRDb25uZWN0aW9ucyA9IHt9XG4gIH1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUYWJsZSBkZXRlY3Rpb25cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFJldHVybnMgdGhlIGRlZGljYXRlZCBhdWRpdCB0YWJsZSBuYW1lIGZvciBhIG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtBdWRpdGVkTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIEF1ZGl0ZWQgbW9kZWwgY2xhc3MuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSBlLmcuIFwicHJvamVjdF9hdWRpdHNcIiBmb3IgYSBcInByb2plY3RzXCIgdGFibGUuXG4gKi9cbmZ1bmN0aW9uIGRlZGljYXRlZEF1ZGl0VGFibGVOYW1lKG1vZGVsQ2xhc3MpIHtcbiAgY29uc3QgdGFibGUgPSBtb2RlbENsYXNzLnRhYmxlTmFtZSgpXG5cbiAgaWYgKHRhYmxlLmVuZHNXaXRoKFwic1wiKSkge1xuICAgIHJldHVybiBgJHt0YWJsZS5zbGljZSgwLCAtMSl9X2F1ZGl0c2BcbiAgfVxuXG4gIHJldHVybiBgJHt0YWJsZX1fYXVkaXRzYFxufVxuXG4vKipcbiAqIFJlc29sdmVzIGF1ZGl0IHRhYmxlIGRhdGEgZm9yIGEgbW9kZWwgY2xhc3MuIENhY2hlZCBwZXIgbW9kZWwuXG4gKiBDYWxsZWQgbGF6aWx5IG9uIGZpcnN0IGNyZWF0ZUF1ZGl0IC8gd2l0aG91dEF1ZGl0IC8gcmVsYXRpb25zaGlwIHVzYWdlLlxuICogQHBhcmFtIHtBdWRpdGVkTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIEF1ZGl0ZWQgbW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBbY29ubmVjdGlvbl0gLSBFeHBsaWNpdCByZWNvcmQtb3duZWQgY29ubmVjdGlvbi5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vb3BlcmF0aW9uLmpzXCIpLmRlZmF1bHR9IFtvcGVyYXRpb25dIC0gRXhwbGljaXQgcmVjb3JkIG9wZXJhdGlvbi5cbiAqIEByZXR1cm5zIHtQcm9taXNlPEF1ZGl0VGFibGVEYXRhPn0gUmVzb2x2ZWQgYXVkaXQgdGFibGUgbWV0YWRhdGEuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHJlc29sdmVBdWRpdFRhYmxlRGF0YShtb2RlbENsYXNzLCBjb25uZWN0aW9uLCBvcGVyYXRpb24pIHtcbiAgY29uc3QgcmVzb2x2ZWRDb25uZWN0aW9uID0gY29ubmVjdGlvbiB8fCBtb2RlbENsYXNzLmNvbm5lY3Rpb24oKVxuICBjb25zdCBkYXRhYmFzZUlkZW50aXR5ID0gYXVkaXREYXRhYmFzZUlkZW50aXR5KG1vZGVsQ2xhc3MsIHJlc29sdmVkQ29ubmVjdGlvbiwgb3BlcmF0aW9uKVxuICBsZXQgdGFibGVEYXRhQnlJZGVudGl0eSA9IGF1ZGl0VGFibGVEYXRhQnlNb2RlbC5nZXQobW9kZWxDbGFzcylcblxuICBpZiAoIXRhYmxlRGF0YUJ5SWRlbnRpdHkpIHtcbiAgICB0YWJsZURhdGFCeUlkZW50aXR5ID0gbmV3IE1hcCgpXG4gICAgYXVkaXRUYWJsZURhdGFCeU1vZGVsLnNldChtb2RlbENsYXNzLCB0YWJsZURhdGFCeUlkZW50aXR5KVxuICB9XG5cbiAgY29uc3QgY2FjaGVkVGFibGVEYXRhID0gdGFibGVEYXRhQnlJZGVudGl0eS5nZXQoZGF0YWJhc2VJZGVudGl0eSlcblxuICBpZiAoY2FjaGVkVGFibGVEYXRhKSB7XG4gICAgcmVnaXN0ZXJBdWRpdFJlbGF0aW9uc2hpcChtb2RlbENsYXNzLCBjYWNoZWRUYWJsZURhdGEsIGRhdGFiYXNlSWRlbnRpdHkpXG4gICAgcmV0dXJuIGNhY2hlZFRhYmxlRGF0YVxuICB9XG5cbiAgY29uc3QgdGFibGVEYXRhID0gYXdhaXQgYnVpbGRBdWRpdFRhYmxlRGF0YShtb2RlbENsYXNzLCByZXNvbHZlZENvbm5lY3Rpb24sIGRhdGFiYXNlSWRlbnRpdHkpXG4gIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSBtb2RlbENsYXNzLl9nZXRDb25maWd1cmF0aW9uKClcblxuICB0YWJsZURhdGEuYXVkaXRDbGFzcy5yZWdpc3RlclJlY29yZENsYXNzKHtjb25maWd1cmF0aW9ufSlcbiAgYXdhaXQgdGFibGVEYXRhLmF1ZGl0Q2xhc3MuaW5pdGlhbGl6ZVJlY29yZCh7Y29uZmlndXJhdGlvbiwgY29ubmVjdGlvbjogcmVzb2x2ZWRDb25uZWN0aW9ufSlcblxuICBtb2RlbENsYXNzLl9hdWRpdFRhYmxlRGF0YSA9IHRhYmxlRGF0YVxuICBtb2RlbENsYXNzLl9hdWRpdFRhYmxlUmVzb2x2ZWQgPSB0cnVlXG4gIHRhYmxlRGF0YUJ5SWRlbnRpdHkuc2V0KGRhdGFiYXNlSWRlbnRpdHksIHRhYmxlRGF0YSlcblxuICByZWdpc3RlckF1ZGl0UmVsYXRpb25zaGlwKG1vZGVsQ2xhc3MsIHRhYmxlRGF0YSwgZGF0YWJhc2VJZGVudGl0eSlcblxuICByZXR1cm4gdGFibGVEYXRhXG59XG5cbi8qKlxuICogQnVpbGRzIGF1ZGl0IHRhYmxlIG1ldGFkYXRhIGZvciBhIG1vZGVsIGNsYXNzLiBQcmVmZXJzIHRoZSBjb25zdW1lcidzXG4gKiByZWdpc3RlcmVkIEF1ZGl0IG1vZGVsIGZvciBzaGFyZWQgdGFibGVzOyBmYWxscyBiYWNrIHRvIGEgZnJhbWV3b3JrLW93bmVkXG4gKiBkeW5hbWljIGNsYXNzLlxuICogQHBhcmFtIHtBdWRpdGVkTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIEF1ZGl0ZWQgbW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBjb25uZWN0aW9uIC0gRXhwbGljaXQgcmVjb3JkLW93bmVkIGNvbm5lY3Rpb24uXG4gKiBAcGFyYW0ge3N0cmluZ30gZGF0YWJhc2VJZGVudGl0eSAtIENhcHR1cmVkIHBoeXNpY2FsIGRhdGFiYXNlIGlkZW50aXR5LlxuICogQHJldHVybnMge1Byb21pc2U8QXVkaXRUYWJsZURhdGE+fSBBdWRpdCB0YWJsZSBtZXRhZGF0YS5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gYnVpbGRBdWRpdFRhYmxlRGF0YShtb2RlbENsYXNzLCBjb25uZWN0aW9uLCBkYXRhYmFzZUlkZW50aXR5KSB7XG4gIGNvbnN0IGRlZGljYXRlZFRhYmxlID0gZGVkaWNhdGVkQXVkaXRUYWJsZU5hbWUobW9kZWxDbGFzcylcbiAgY29uc3QgZGVkaWNhdGVkRXhpc3RzID0gYXdhaXQgZGVkaWNhdGVkVGFibGVFeGlzdHNGb3JDb25uZWN0aW9uKG1vZGVsQ2xhc3MsIGRlZGljYXRlZFRhYmxlLCBjb25uZWN0aW9uLCBkYXRhYmFzZUlkZW50aXR5KVxuXG4gIGlmIChkZWRpY2F0ZWRFeGlzdHMpIHtcbiAgICBjb25zdCBhdWRpdENsYXNzID0gZGVkaWNhdGVkQXVkaXRDbGFzcyhtb2RlbENsYXNzLCBkZWRpY2F0ZWRUYWJsZSlcbiAgICBjb25zdCBtb2RlbEtleSA9IG1vZGVsUGFyYW1LZXkobW9kZWxDbGFzcylcblxuICAgIHJldHVybiB7XG4gICAgICBhdWRpdENsYXNzLFxuICAgICAgZGVkaWNhdGVkOiB0cnVlLFxuICAgICAgZm9yZWlnbktleTogYCR7bW9kZWxLZXl9X2lkYCxcbiAgICAgIHRhYmxlTmFtZTogZGVkaWNhdGVkVGFibGVcbiAgICB9XG4gIH1cblxuICBjb25zdCBjb25maWd1cmF0aW9uID0gbW9kZWxDbGFzcy5fZ2V0Q29uZmlndXJhdGlvbigpXG5cbiAgY29uc3QgY29uc3VtZXJBdWRpdENsYXNzID0gY29uZmlndXJhdGlvbi5nZXRNb2RlbENsYXNzZXMoKS5BdWRpdFxuXG4gIGlmIChjb25zdW1lckF1ZGl0Q2xhc3MpIHtcbiAgICByZXR1cm4ge1xuICAgICAgYXVkaXRDbGFzczogY29uc3VtZXJBdWRpdENsYXNzLFxuICAgICAgZGVkaWNhdGVkOiBmYWxzZSxcbiAgICAgIGZvcmVpZ25LZXk6IFwiYXVkaXRhYmxlX2lkXCIsXG4gICAgICB0YWJsZU5hbWU6IFwiYXVkaXRzXCJcbiAgICB9XG4gIH1cblxuICByZXR1cm4ge1xuICAgIGF1ZGl0Q2xhc3M6IGNhY2hlZFNoYXJlZEF1ZGl0Q2xhc3MobW9kZWxDbGFzcyksXG4gICAgZGVkaWNhdGVkOiBmYWxzZSxcbiAgICBmb3JlaWduS2V5OiBcImF1ZGl0YWJsZV9pZFwiLFxuICAgIHRhYmxlTmFtZTogXCJhdWRpdHNcIlxuICB9XG59XG5cbi8qKlxuICogQ2hlY2tzIHdoZXRoZXIgYSBkZWRpY2F0ZWQgYXVkaXQgdGFibGUgZXhpc3RzIGZvciBhIG1vZGVsJ3MgY29ubmVjdGlvbi5cbiAqIEBwYXJhbSB7QXVkaXRlZE1vZGVsQ2xhc3N9IG1vZGVsQ2xhc3MgLSBBdWRpdGVkIG1vZGVsIGNsYXNzIG93bmluZyB0aGUgQ29uZmlndXJhdGlvbi5cbiAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBEZWRpY2F0ZWQgYXVkaXQgdGFibGUgbmFtZSB0byBjaGVjay5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBFeHBsaWNpdCByZWNvcmQtb3duZWQgY29ubmVjdGlvbi5cbiAqIEBwYXJhbSB7c3RyaW5nfSBkYXRhYmFzZUlkZW50aXR5IC0gQ2FwdHVyZWQgcGh5c2ljYWwgZGF0YWJhc2UgaWRlbnRpdHkuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gV2hldGhlciB0aGUgdGFibGUgZXhpc3RzLlxuICovXG5hc3luYyBmdW5jdGlvbiBkZWRpY2F0ZWRUYWJsZUV4aXN0c0ZvckNvbm5lY3Rpb24obW9kZWxDbGFzcywgdGFibGVOYW1lLCBjb25uZWN0aW9uLCBkYXRhYmFzZUlkZW50aXR5KSB7XG4gIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSBtb2RlbENsYXNzLl9nZXRDb25maWd1cmF0aW9uKClcbiAgY29uc3QgY2FjaGVLZXkgPSBgJHtkYXRhYmFzZUlkZW50aXR5fToke3RhYmxlTmFtZX1gXG4gIGxldCBkZWRpY2F0ZWRUYWJsZUNhY2hlID0gZGVkaWNhdGVkVGFibGVDYWNoZUJ5Q29uZmlndXJhdGlvbi5nZXQoY29uZmlndXJhdGlvbilcblxuICBpZiAoIWRlZGljYXRlZFRhYmxlQ2FjaGUpIHtcbiAgICBkZWRpY2F0ZWRUYWJsZUNhY2hlID0gbmV3IE1hcCgpXG4gICAgZGVkaWNhdGVkVGFibGVDYWNoZUJ5Q29uZmlndXJhdGlvbi5zZXQoY29uZmlndXJhdGlvbiwgZGVkaWNhdGVkVGFibGVDYWNoZSlcbiAgfVxuXG4gIGNvbnN0IGNhY2hlZCA9IGRlZGljYXRlZFRhYmxlQ2FjaGUuZ2V0KGNhY2hlS2V5KVxuXG4gIGlmICh0eXBlb2YgY2FjaGVkID09PSBcImJvb2xlYW5cIikge1xuICAgIHJldHVybiBjYWNoZWRcbiAgfVxuXG4gIGNvbnN0IHRhYmxlID0gYXdhaXQgY29ubmVjdGlvbi5nZXRUYWJsZUJ5TmFtZSh0YWJsZU5hbWUsIHt0aHJvd0Vycm9yOiBmYWxzZX0pXG4gIGNvbnN0IGV4aXN0cyA9IEJvb2xlYW4odGFibGUpXG5cbiAgZGVkaWNhdGVkVGFibGVDYWNoZS5zZXQoY2FjaGVLZXksIGV4aXN0cylcblxuICByZXR1cm4gZXhpc3RzXG59XG5cbi8qKlxuICogUmVzb2x2ZXMgYSBjYWNoZSBpZGVudGl0eSBmcm9tIGV4cGxpY2l0IG9wZXJhdGlvbiBvd25lcnNoaXAgb3IgdGhlIGFjdHVhbFxuICogc3RhbXBlZCBwb29sIGNvbm5lY3Rpb24uIEFtYmllbnQgdGVuYW50IHN0YXRlIGlzIG5ldmVyIHVzZWQgd2hlbiBhblxuICogb3BlcmF0aW9uIGlzIGF2YWlsYWJsZS5cbiAqIEBwYXJhbSB7QXVkaXRlZE1vZGVsQ2xhc3N9IG1vZGVsQ2xhc3MgLSBBdWRpdGVkIG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gY29ubmVjdGlvbiAtIEFjdHVhbCBjb25uZWN0aW9uLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9vcGVyYXRpb24uanNcIikuZGVmYXVsdH0gW29wZXJhdGlvbl0gLSBFeHBsaWNpdCBvcGVyYXRpb24uXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFBoeXNpY2FsIGRhdGFiYXNlIGlkZW50aXR5LlxuICovXG5mdW5jdGlvbiBhdWRpdERhdGFiYXNlSWRlbnRpdHkobW9kZWxDbGFzcywgY29ubmVjdGlvbiwgb3BlcmF0aW9uKSB7XG4gIGlmIChvcGVyYXRpb24pIHJldHVybiBvcGVyYXRpb24uZGF0YWJhc2VJZGVudGl0eSgpXG5cbiAgY29uc3QgZGF0YWJhc2VJZGVudGlmaWVyID0gbW9kZWxDbGFzcy5nZXREYXRhYmFzZUlkZW50aWZpZXIoKVxuICBjb25zdCBwb29sID0gbW9kZWxDbGFzcy5fZ2V0Q29uZmlndXJhdGlvbigpLmdldERhdGFiYXNlUG9vbChkYXRhYmFzZUlkZW50aWZpZXIpXG5cbiAgcmV0dXJuIGAke2RhdGFiYXNlSWRlbnRpZmllcn06JHtwb29sLmdldENvbm5lY3Rpb25Db25maWd1cmF0aW9uUmV1c2VLZXkoY29ubmVjdGlvbil9YFxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIER5bmFtaWMgYXVkaXQgY2xhc3Nlc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogUmV0dXJucyBhIGZyYW1ld29yay1vd25lZCBzaGFyZWQgQXVkaXQgY2xhc3MgZm9yIHRoZSBgYXVkaXRzYCB0YWJsZS5cbiAqIFRoaXMgaXMgb25seSB1c2VkIHdoZW4gbm8gY29uc3VtZXItcmVnaXN0ZXJlZCBBdWRpdCBtb2RlbCBleGlzdHMuXG4gKiBAcGFyYW0ge0F1ZGl0ZWRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gQW55IGF1ZGl0ZWQgbW9kZWwgY2xhc3MgKHVzZWQgdG8gbG9jYXRlIERhdGFiYXNlUmVjb3JkKS5cbiAqIEByZXR1cm5zIHt0eXBlb2YgaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBTaGFyZWQgQXVkaXQgbW9kZWwgY2xhc3MuXG4gKi9cbmZ1bmN0aW9uIHNoYXJlZEF1ZGl0Q2xhc3MobW9kZWxDbGFzcykge1xuICBjb25zdCBkYlJlY29yZENsYXNzID0gZmluZERhdGFiYXNlUmVjb3JkQ2xhc3MobW9kZWxDbGFzcylcblxuICAvKipcbiAgICogRnJhbWV3b3JrLW93bmVkIEF1ZGl0IG1vZGVsIGZvciB0aGUgc2hhcmVkIGBhdWRpdHNgIHRhYmxlLlxuICAgKi9cbiAgY2xhc3MgQXVkaXQgZXh0ZW5kcyBkYlJlY29yZENsYXNzIHtcbiAgICAvKipcbiAgICAgKiBSZXR1cm5zIHRoZSBiYWNraW5nIHRhYmxlIG5hbWUuXG4gICAgICogQHJldHVybnMge3N0cmluZ30gLSBTaGFyZWQgYGF1ZGl0c2AgdGFibGUgbmFtZS5cbiAgICAgKi9cbiAgICBzdGF0aWMgdGFibGVOYW1lKCkge1xuICAgICAgcmV0dXJuIFwiYXVkaXRzXCJcbiAgICB9XG4gIH1cblxuICBPYmplY3QuZGVmaW5lUHJvcGVydHkoQXVkaXQsIFwibW9kZWxOYW1lXCIsIHt2YWx1ZTogXCJBdWRpdFwiLCB3cml0YWJsZTogZmFsc2V9KVxuICBhcHBseUF1ZGl0Q2xhc3NEYXRhYmFzZVJvdXRpbmcobW9kZWxDbGFzcywgQXVkaXQpXG5cbiAgcmV0dXJuIC8qKiBAdHlwZSB7dHlwZW9mIGltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gKi8gKEF1ZGl0KVxufVxuXG4vKipcbiAqIFJldHVybnMgdGhlIGNhY2hlZCBmcmFtZXdvcmstb3duZWQgc2hhcmVkIEF1ZGl0IGNsYXNzIGZvciBhIGRhdGFiYXNlLlxuICogQHBhcmFtIHtBdWRpdGVkTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIEFueSBhdWRpdGVkIG1vZGVsIGNsYXNzLlxuICogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IFNoYXJlZCBBdWRpdCBtb2RlbCBjbGFzcy5cbiAqL1xuZnVuY3Rpb24gY2FjaGVkU2hhcmVkQXVkaXRDbGFzcyhtb2RlbENsYXNzKSB7XG4gIGNvbnN0IHJvdXRpbmdLZXkgPSBtb2RlbENsYXNzLmhhc1RlbmFudERhdGFiYXNlSWRlbnRpZmllclJlc29sdmVyKClcbiAgICA/IGB0ZW5hbnQ6JHttb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpfWBcbiAgICA6IGBkYXRhYmFzZToke21vZGVsQ2xhc3MuZ2V0Q29uZmlndXJlZERhdGFiYXNlSWRlbnRpZmllcigpfWBcbiAgY29uc3QgY2FjaGVLZXkgPSBgc2hhcmVkOiR7cm91dGluZ0tleX1gXG4gIGxldCBhdWRpdENsYXNzID0gYXVkaXRDbGFzc0NhY2hlLmdldChjYWNoZUtleSlcblxuICBpZiAoIWF1ZGl0Q2xhc3MpIHtcbiAgICBhdWRpdENsYXNzID0gc2hhcmVkQXVkaXRDbGFzcyhtb2RlbENsYXNzKVxuICAgIGF1ZGl0Q2xhc3NDYWNoZS5zZXQoY2FjaGVLZXksIGF1ZGl0Q2xhc3MpXG4gIH1cblxuICByZXR1cm4gYXVkaXRDbGFzc1xufVxuXG4vKipcbiAqIFJldHVybnMgYSBkeW5hbWljIHBlci1tb2RlbCBhdWRpdCBjbGFzcyBmb3IgYSBkZWRpY2F0ZWQgdGFibGUuXG4gKiBAcGFyYW0ge0F1ZGl0ZWRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gQXVkaXRlZCBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7c3RyaW5nfSB0YWJsZU5hbWUgLSBEZWRpY2F0ZWQgYXVkaXQgdGFibGUgbmFtZSAoZS5nLiBcInByb2plY3RfYXVkaXRzXCIpLlxuICogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IERlZGljYXRlZCBhdWRpdCBtb2RlbCBjbGFzcy5cbiAqL1xuZnVuY3Rpb24gZGVkaWNhdGVkQXVkaXRDbGFzcyhtb2RlbENsYXNzLCB0YWJsZU5hbWUpIHtcbiAgY29uc3QgZGJSZWNvcmRDbGFzcyA9IGZpbmREYXRhYmFzZVJlY29yZENsYXNzKG1vZGVsQ2xhc3MpXG4gIGNvbnN0IG1vZGVsTmFtZSA9IG1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKClcbiAgY29uc3QgbW9kZWxLZXkgPSBtb2RlbFBhcmFtS2V5KG1vZGVsQ2xhc3MpXG5cbiAgLyoqXG4gICAqIEZyYW1ld29yay1vd25lZCBwZXItbW9kZWwgQXVkaXQgY2xhc3MuXG4gICAqL1xuICBjbGFzcyBNb2RlbEF1ZGl0IGV4dGVuZHMgZGJSZWNvcmRDbGFzcyB7XG4gICAgLyoqXG4gICAgICogUmV0dXJucyB0aGUgYmFja2luZyB0YWJsZSBuYW1lLlxuICAgICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRGVkaWNhdGVkIGF1ZGl0IHRhYmxlIHN1cHBsaWVkIGZvciB0aGlzIG1vZGVsIGNsYXNzLlxuICAgICAqL1xuICAgIHN0YXRpYyB0YWJsZU5hbWUoKSB7XG4gICAgICByZXR1cm4gdGFibGVOYW1lXG4gICAgfVxuICB9XG5cbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5KE1vZGVsQXVkaXQsIFwibW9kZWxOYW1lXCIsIHt2YWx1ZTogYCR7bW9kZWxOYW1lfUF1ZGl0YCwgd3JpdGFibGU6IGZhbHNlfSlcbiAgYXBwbHlBdWRpdENsYXNzRGF0YWJhc2VSb3V0aW5nKG1vZGVsQ2xhc3MsIE1vZGVsQXVkaXQpXG4gIE1vZGVsQXVkaXQuYmVsb25nc1RvKG1vZGVsS2V5LCB7Y2xhc3NOYW1lOiBtb2RlbE5hbWV9KVxuXG4gIHJldHVybiAvKiogQHR5cGUge3R5cGVvZiBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9ICovIChNb2RlbEF1ZGl0KVxufVxuXG4vKipcbiAqIE1ha2VzIGZyYW1ld29yay1vd25lZCBhdWRpdCBjbGFzc2VzIHJlYWQgdGhlIHNhbWUgZGF0YWJhc2UgYXMgdGhlIGF1ZGl0ZWQgbW9kZWwuXG4gKiBAcGFyYW0ge0F1ZGl0ZWRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gQXVkaXRlZCBzb3VyY2UgbW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IGF1ZGl0Q2xhc3MgLSBHZW5lcmF0ZWQgYXVkaXQgY2xhc3MuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gYXBwbHlBdWRpdENsYXNzRGF0YWJhc2VSb3V0aW5nKG1vZGVsQ2xhc3MsIGF1ZGl0Q2xhc3MpIHtcbiAgYXVkaXRDbGFzcy5zZXREYXRhYmFzZUlkZW50aWZpZXIobW9kZWxDbGFzcy5nZXRDb25maWd1cmVkRGF0YWJhc2VJZGVudGlmaWVyKCkpXG5cbiAgaWYgKG1vZGVsQ2xhc3MuaGFzVGVuYW50RGF0YWJhc2VJZGVudGlmaWVyUmVzb2x2ZXIoKSkge1xuICAgIGF1ZGl0Q2xhc3Muc3dpdGNoZXNUZW5hbnREYXRhYmFzZSgoe3RlbmFudH0pID0+IG1vZGVsQ2xhc3MuZ2V0VGVuYW50RGF0YWJhc2VJZGVudGlmaWVyKHRlbmFudCkpXG4gIH1cbn1cblxuLyoqXG4gKiBXYWxrcyB0aGUgcHJvdG90eXBlIGNoYWluIHRvIGZpbmQgdGhlIHJvb3QgRGF0YWJhc2VSZWNvcmQgY2xhc3MuXG4gKiBAcGFyYW0ge0F1ZGl0ZWRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gQXVkaXRlZCBtb2RlbCBjbGFzcy5cbiAqIEByZXR1cm5zIHt0eXBlb2YgaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBSb290IERhdGFiYXNlUmVjb3JkIGNsYXNzLlxuICovXG5mdW5jdGlvbiBmaW5kRGF0YWJhc2VSZWNvcmRDbGFzcyhtb2RlbENsYXNzKSB7XG4gIGxldCByZWNvcmRDbGFzcyA9IE9iamVjdC5nZXRQcm90b3R5cGVPZihtb2RlbENsYXNzKVxuXG4gIHdoaWxlIChyZWNvcmRDbGFzcyAmJiBPYmplY3QuZ2V0UHJvdG90eXBlT2YocmVjb3JkQ2xhc3MpICE9PSBGdW5jdGlvbi5wcm90b3R5cGUpIHtcbiAgICByZWNvcmRDbGFzcyA9IE9iamVjdC5nZXRQcm90b3R5cGVPZihyZWNvcmRDbGFzcylcbiAgfVxuXG4gIHJldHVybiAvKiogQHR5cGUge3R5cGVvZiBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9ICovIChyZWNvcmRDbGFzcylcbn1cblxuLyoqXG4gKiBSZXR1cm5zIHRoZSBwYXJhbWV0ZXIta2V5IG5hbWUgZm9yIGEgbW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge0F1ZGl0ZWRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gQXVkaXRlZCBtb2RlbCBjbGFzcy5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IGUuZy4gXCJwcm9qZWN0XCIgZm9yIFwiUHJvamVjdFwiLlxuICovXG5mdW5jdGlvbiBtb2RlbFBhcmFtS2V5KG1vZGVsQ2xhc3MpIHtcbiAgY29uc3QgbmFtZSA9IG1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKClcblxuICByZXR1cm4gbmFtZS5jaGFyQXQoMCkudG9Mb3dlckNhc2UoKSArIG5hbWUuc2xpY2UoMSlcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBSZWdpc3RyYXRpb24gKHN5bmMg4oCUIGNhbGxiYWNrcyBvbmx5OyB0YWJsZSBkZXRlY3Rpb24gZGVmZXJyZWQpXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBSZWdpc3RlcnMgbGlmZWN5Y2xlIGNhbGxiYWNrcyBmb3IgYXV0b21hdGljIGNyZWF0ZS91cGRhdGUvZGVzdHJveSBhdWRpdGluZy5cbiAqIFRhYmxlIGRldGVjdGlvbiBhbmQgcmVsYXRpb25zaGlwIHJlZ2lzdHJhdGlvbiBoYXBwZW4gbGF6aWx5IG9uIGZpcnN0IHVzYWdlLlxuICogQ2FsbGVkIHN5bmNocm9ub3VzbHkgZnJvbSBNb2RlbC5hdWRpdGVkKCkgYXQgbW9kdWxlLWxvYWQgdGltZS5cbiAqIEBwYXJhbSB7QXVkaXRlZE1vZGVsQ2xhc3N9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcyB0byBhdWRpdC5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiByZWdpc3RlckF1ZGl0aW5nKG1vZGVsQ2xhc3MpIHtcbiAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChtb2RlbENsYXNzLCBcIl9hdWRpdExpZmVjeWNsZUNhbGxiYWNrc1JlZ2lzdGVyZWRcIikgJiYgbW9kZWxDbGFzcy5fYXVkaXRMaWZlY3ljbGVDYWxsYmFja3NSZWdpc3RlcmVkKSB7XG4gICAgcmV0dXJuXG4gIH1cblxuICBtb2RlbENsYXNzLl9hdWRpdExpZmVjeWNsZUNhbGxiYWNrc1JlZ2lzdGVyZWQgPSB0cnVlXG4gIHJlZ2lzdGVyQXVkaXRSZWxhdGlvbnNoaXAobW9kZWxDbGFzcylcbiAgbW9kZWxDbGFzcy5iZWZvcmVDcmVhdGUoXCJjYXB0dXJlQ3JlYXRlQXVkaXRDaGFuZ2VzXCIpXG4gIG1vZGVsQ2xhc3MuYWZ0ZXJDcmVhdGUoXCJjcmVhdGVDcmVhdGVBdWRpdFwiKVxuICBtb2RlbENsYXNzLmJlZm9yZVVwZGF0ZShcImNhcHR1cmVVcGRhdGVBdWRpdENoYW5nZXNcIilcbiAgbW9kZWxDbGFzcy5hZnRlclVwZGF0ZShcImNyZWF0ZVVwZGF0ZUF1ZGl0XCIpXG4gIG1vZGVsQ2xhc3MuYWZ0ZXJEZXN0cm95KFwiY3JlYXRlRGVzdHJveUF1ZGl0XCIpXG59XG5cbi8qKlxuICogSW5pdGlhbGl6ZXMgYXVkaXQgbWV0YWRhdGEgZm9yIGF1ZGl0ZWQgbW9kZWwgY2xhc3Nlcy5cbiAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzIHRvIGluaXRpYWxpemUuXG4gKiBAcGFyYW0ge3tyZXNvbHZlVGFibGVEYXRhPzogYm9vbGVhbn19IFthcmdzXSAtIEluaXRpYWxpemF0aW9uIG9wdGlvbnMuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAqL1xuYXN5bmMgZnVuY3Rpb24gaW5pdGlhbGl6ZUF1ZGl0aW5nKG1vZGVsQ2xhc3MsIGFyZ3MgPSB7fSkge1xuICBjb25zdCB7cmVzb2x2ZVRhYmxlRGF0YSA9IGZhbHNlfSA9IGFyZ3NcbiAgY29uc3QgYXVkaXRlZE1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge0F1ZGl0ZWRNb2RlbENsYXNzfSAqLyAobW9kZWxDbGFzcylcblxuICBpZiAoIWF1ZGl0ZWRNb2RlbENsYXNzLl9hdWRpdExpZmVjeWNsZUNhbGxiYWNrc1JlZ2lzdGVyZWQpIHtcbiAgICByZXR1cm5cbiAgfVxuXG4gIHJlZ2lzdGVyQXVkaXRSZWxhdGlvbnNoaXAoYXVkaXRlZE1vZGVsQ2xhc3MpXG5cbiAgaWYgKHJlc29sdmVUYWJsZURhdGEgJiYgc2hvdWxkUmVzb2x2ZUF1ZGl0VGFibGVEYXRhKGF1ZGl0ZWRNb2RlbENsYXNzKSkge1xuICAgIGF3YWl0IHJlc29sdmVBdWRpdFRhYmxlRGF0YShhdWRpdGVkTW9kZWxDbGFzcylcbiAgfVxufVxuXG4vKipcbiAqIFJlc29sdmVzIGF1ZGl0IG1ldGFkYXRhIGFmdGVyIGFwcGxpY2F0aW9uIGFuZCBwYWNrYWdlIG1vZGVsIGNsYXNzZXMgYXJlIHJlZ2lzdGVyZWQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uLy4uL2NvbmZpZ3VyYXRpb24uanNcIikuZGVmYXVsdH0gY29uZmlndXJhdGlvbiAtIENvbmZpZ3VyYXRpb24gd2hvc2UgbW9kZWxzIHNob3VsZCBiZSBmaW5hbGl6ZWQuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAqL1xuYXN5bmMgZnVuY3Rpb24gaW5pdGlhbGl6ZUF1ZGl0ZWRNb2RlbFJlbGF0aW9uc2hpcHMoY29uZmlndXJhdGlvbikge1xuICBjb25zdCBtb2RlbENsYXNzZXMgPSBPYmplY3QudmFsdWVzKGNvbmZpZ3VyYXRpb24uZ2V0TW9kZWxDbGFzc2VzKCkpXG4gIGNvbnN0IHNob3VsZFJlc29sdmVUYWJsZURhdGEgPSBtb2RlbENsYXNzZXMuc29tZSgobW9kZWxDbGFzcykgPT4gc2hvdWxkUmVzb2x2ZUF1ZGl0VGFibGVEYXRhKG1vZGVsQ2xhc3MpKVxuXG4gIGlmICghc2hvdWxkUmVzb2x2ZVRhYmxlRGF0YSkge1xuICAgIGZvciAoY29uc3QgbW9kZWxDbGFzcyBvZiBtb2RlbENsYXNzZXMpIHtcbiAgICAgIGF3YWl0IGluaXRpYWxpemVBdWRpdGluZyhtb2RlbENsYXNzKVxuICAgIH1cblxuICAgIHJldHVyblxuICB9XG5cbiAgYXdhaXQgY29uZmlndXJhdGlvbi5lbnN1cmVDb25uZWN0aW9ucyh7bmFtZTogXCJJbml0aWFsaXplIGF1ZGl0ZWQgbW9kZWwgcmVsYXRpb25zaGlwc1wifSwgYXN5bmMgKCkgPT4ge1xuICAgIGZvciAoY29uc3QgbW9kZWxDbGFzcyBvZiBtb2RlbENsYXNzZXMpIHtcbiAgICAgIGF3YWl0IGluaXRpYWxpemVBdWRpdGluZyhtb2RlbENsYXNzLCB7cmVzb2x2ZVRhYmxlRGF0YTogdHJ1ZX0pXG4gICAgfVxuICB9KVxufVxuXG4vKipcbiAqIENoZWNrcyB3aGV0aGVyIGF1ZGl0IHRhYmxlIG1ldGFkYXRhIHNob3VsZCBiZSByZXNvbHZlZCBmb3IgYSBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzIHRvIGluc3BlY3QuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciB0YWJsZSBtZXRhZGF0YSByZXNvbHV0aW9uIHNob3VsZCBydW4gbm93LlxuICovXG5mdW5jdGlvbiBzaG91bGRSZXNvbHZlQXVkaXRUYWJsZURhdGEobW9kZWxDbGFzcykge1xuICBjb25zdCBhdWRpdGVkTW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7QXVkaXRlZE1vZGVsQ2xhc3N9ICovIChtb2RlbENsYXNzKVxuXG4gIGlmICghYXVkaXRlZE1vZGVsQ2xhc3MuX2F1ZGl0TGlmZWN5Y2xlQ2FsbGJhY2tzUmVnaXN0ZXJlZCkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgcmV0dXJuIEJvb2xlYW4oYXVkaXRlZE1vZGVsQ2xhc3MuX2luaXRpYWxpemVkKSAmJiBjYW5SZXNvbHZlQXVkaXRUYWJsZURhdGEoYXVkaXRlZE1vZGVsQ2xhc3MpXG59XG5cbi8qKlxuICogUmVnaXN0ZXJzIHRoZSBhdWRpdHMgcmVsYXRpb25zaGlwIHdpdGhvdXQgZm9yY2luZyBhdWRpdCB0YWJsZSBkZXRlY3Rpb24uXG4gKiBAcGFyYW0ge0F1ZGl0ZWRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MgdG8gYXVkaXQuXG4gKiBAcGFyYW0ge0F1ZGl0VGFibGVEYXRhfSBbdGFibGVEYXRhXSAtIFJlc29sdmVkIGF1ZGl0IHRhYmxlIGRhdGEgd2hlbiBhdmFpbGFibGUuXG4gKiBAcGFyYW0ge3N0cmluZ30gW2RhdGFiYXNlSWRlbnRpdHldIC0gUmVzb2x2ZWQgcGh5c2ljYWwgZGF0YWJhc2UgaWRlbnRpdHkuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gcmVnaXN0ZXJBdWRpdFJlbGF0aW9uc2hpcChtb2RlbENsYXNzLCB0YWJsZURhdGEgPSBkZWZhdWx0QXVkaXRSZWxhdGlvbnNoaXBUYWJsZURhdGEobW9kZWxDbGFzcyksIGRhdGFiYXNlSWRlbnRpdHkpIHtcbiAgaWYgKG1vZGVsQ2xhc3MuX3JlbGF0aW9uc2hpcEV4aXN0cyhcImF1ZGl0c1wiKSkge1xuICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IG1vZGVsQ2xhc3MuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKFwiYXVkaXRzXCIpXG5cbiAgICBpZiAoZ2VuZXJhdGVkQXVkaXRSZWxhdGlvbnNoaXBzLmhhcyhyZWxhdGlvbnNoaXApICYmIGRhdGFiYXNlSWRlbnRpdHkpIHtcbiAgICAgIGF1ZGl0UmVsYXRpb25zaGlwTWFwKG1vZGVsQ2xhc3MpLnNldChkYXRhYmFzZUlkZW50aXR5LCBidWlsZEF1ZGl0UmVsYXRpb25zaGlwKG1vZGVsQ2xhc3MsIHRhYmxlRGF0YSkpXG4gICAgfVxuXG4gICAgcmV0dXJuXG4gIH1cblxuICBtb2RlbENsYXNzLmhhc01hbnkoXCJhdWRpdHNcIiwgYXVkaXRSZWxhdGlvbnNoaXBTY29wZSwge1xuICAgIGZvcmVpZ25LZXk6IHRhYmxlRGF0YS5mb3JlaWduS2V5LFxuICAgIGtsYXNzOiB0YWJsZURhdGEuYXVkaXRDbGFzcyxcbiAgICBwb2x5bW9ycGhpYzogIXRhYmxlRGF0YS5kZWRpY2F0ZWRcbiAgfSlcbiAgY29uc3QgcmVsYXRpb25zaGlwID0gbW9kZWxDbGFzcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUoXCJhdWRpdHNcIilcblxuICBnZW5lcmF0ZWRBdWRpdFJlbGF0aW9uc2hpcHMuYWRkKHJlbGF0aW9uc2hpcClcbiAgcmVsYXRpb25zaGlwLnNldFJlY29yZFJlc29sdmVyKChyZWNvcmQpID0+IHtcbiAgICBjb25zdCByZWxhdGlvbnNoaXBzID0gYXVkaXRSZWxhdGlvbnNoaXBNYXAobW9kZWxDbGFzcylcbiAgICBjb25zdCBvcGVyYXRpb24gPSByZWNvcmQuZGF0YWJhc2VPcGVyYXRpb24oKVxuXG4gICAgaWYgKG9wZXJhdGlvbikgcmV0dXJuIHJlbGF0aW9uc2hpcHMuZ2V0KG9wZXJhdGlvbi5kYXRhYmFzZUlkZW50aXR5KCkpIHx8IHJlbGF0aW9uc2hpcFxuICAgIGlmIChyZWxhdGlvbnNoaXBzLnNpemUgPT09IDEpIHJldHVybiBbLi4ucmVsYXRpb25zaGlwcy52YWx1ZXMoKV1bMF1cblxuICAgIGNvbnN0IGlkZW50aXR5ID0gYXVkaXREYXRhYmFzZUlkZW50aXR5KG1vZGVsQ2xhc3MsIHJlY29yZC5jb25uZWN0aW9uKCkpXG5cbiAgICByZXR1cm4gcmVsYXRpb25zaGlwcy5nZXQoaWRlbnRpdHkpIHx8IHJlbGF0aW9uc2hpcFxuICB9KVxufVxuXG4vKipcbiAqIFJldHVybnMgcGh5c2ljYWwgYXVkaXQgcmVsYXRpb25zaGlwIHZhcmlhbnRzIGZvciBhIG1vZGVsLlxuICogQHBhcmFtIHtBdWRpdGVkTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIEF1ZGl0ZWQgbW9kZWwgY2xhc3MuXG4gKiBAcmV0dXJucyB7TWFwPHN0cmluZywgSGFzTWFueVJlbGF0aW9uc2hpcD59IC0gUmVsYXRpb25zaGlwcyBrZXllZCBieSBwaHlzaWNhbCBkYXRhYmFzZSBpZGVudGl0eS5cbiAqL1xuZnVuY3Rpb24gYXVkaXRSZWxhdGlvbnNoaXBNYXAobW9kZWxDbGFzcykge1xuICBsZXQgcmVsYXRpb25zaGlwcyA9IGF1ZGl0UmVsYXRpb25zaGlwc0J5TW9kZWwuZ2V0KG1vZGVsQ2xhc3MpXG5cbiAgaWYgKCFyZWxhdGlvbnNoaXBzKSB7XG4gICAgcmVsYXRpb25zaGlwcyA9IG5ldyBNYXAoKVxuICAgIGF1ZGl0UmVsYXRpb25zaGlwc0J5TW9kZWwuc2V0KG1vZGVsQ2xhc3MsIHJlbGF0aW9uc2hpcHMpXG4gIH1cblxuICByZXR1cm4gcmVsYXRpb25zaGlwc1xufVxuXG4vKipcbiAqIEJ1aWxkcyBpbW11dGFibGUtYnktb3duZXJzaGlwIGF1ZGl0IHJlbGF0aW9uc2hpcCBtZXRhZGF0YSBmb3Igb25lIHBoeXNpY2FsIGRhdGFiYXNlLlxuICogQHBhcmFtIHtBdWRpdGVkTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIEF1ZGl0ZWQgbW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge0F1ZGl0VGFibGVEYXRhfSB0YWJsZURhdGEgLSBSZXNvbHZlZCBhdWRpdCB0YWJsZSBkYXRhLlxuICogQHJldHVybnMge0hhc01hbnlSZWxhdGlvbnNoaXB9IC0gUGh5c2ljYWwgcmVsYXRpb25zaGlwIGRlZmluaXRpb24uXG4gKi9cbmZ1bmN0aW9uIGJ1aWxkQXVkaXRSZWxhdGlvbnNoaXAobW9kZWxDbGFzcywgdGFibGVEYXRhKSB7XG4gIHJldHVybiBuZXcgSGFzTWFueVJlbGF0aW9uc2hpcCh7XG4gICAgZm9yZWlnbktleTogdGFibGVEYXRhLmZvcmVpZ25LZXksXG4gICAga2xhc3M6IHRhYmxlRGF0YS5hdWRpdENsYXNzLFxuICAgIG1vZGVsQ2xhc3MsXG4gICAgcG9seW1vcnBoaWM6ICF0YWJsZURhdGEuZGVkaWNhdGVkLFxuICAgIHJlbGF0aW9uc2hpcE5hbWU6IFwiYXVkaXRzXCIsXG4gICAgc2NvcGU6IGF1ZGl0UmVsYXRpb25zaGlwU2NvcGUsXG4gICAgdHlwZTogXCJoYXNNYW55XCJcbiAgfSlcbn1cblxuLyoqXG4gKiBSZXR1cm5zIHVucmVzb2x2ZWQgc2hhcmVkLWF1ZGl0IGRlZmF1bHRzIGZvciBlYXJseSByZWxhdGlvbnNoaXAgcmVnaXN0cmF0aW9uLlxuICogQHBhcmFtIHtBdWRpdGVkTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzIHRvIGF1ZGl0LlxuICogQHJldHVybnMge0F1ZGl0VGFibGVEYXRhfSBTaGFyZWQgYXVkaXQgcmVsYXRpb25zaGlwIGRlZmF1bHRzLlxuICovXG5mdW5jdGlvbiBkZWZhdWx0QXVkaXRSZWxhdGlvbnNoaXBUYWJsZURhdGEobW9kZWxDbGFzcykge1xuICByZXR1cm4ge1xuICAgIGF1ZGl0Q2xhc3M6IGNhY2hlZFNoYXJlZEF1ZGl0Q2xhc3MobW9kZWxDbGFzcyksXG4gICAgZGVkaWNhdGVkOiBmYWxzZSxcbiAgICBmb3JlaWduS2V5OiBcImF1ZGl0YWJsZV9pZFwiLFxuICAgIHRhYmxlTmFtZTogXCJhdWRpdHNcIlxuICB9XG59XG5cbi8qKlxuICogQXBwbGllcyBkZWZhdWx0IGF1ZGl0IG9yZGVyaW5nIHRvIGdlbmVyYXRlZCBhdWRpdCByZWxhdGlvbnNoaXBzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PHR5cGVvZiBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHQ+fSBxdWVyeSAtIEF1ZGl0IHF1ZXJ5LlxuICogQHJldHVybnMge2ltcG9ydChcIi4uL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdD59IE9yZGVyZWQgYXVkaXQgcXVlcnkuXG4gKi9cbmZ1bmN0aW9uIGF1ZGl0UmVsYXRpb25zaGlwU2NvcGUocXVlcnkpIHtcbiAgcmV0dXJuIHF1ZXJ5Lm9yZGVyKHtjb2x1bW46IFwiY3JlYXRlZF9hdFwiLCBkaXJlY3Rpb246IFwiREVTQ1wifSlcbn1cblxuLyoqXG4gKiBDaGVja3Mgd2hldGhlciB0aGUgY3VycmVudCB0ZW5hbnQgY29udGV4dCBjYW4gcmVzb2x2ZSBhdWRpdCB0YWJsZSBkYXRhLlxuICogQHBhcmFtIHtBdWRpdGVkTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzIHRvIGluc3BlY3QuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciBhdWRpdCB0YWJsZSBkYXRhIGNhbiBiZSByZXNvbHZlZCBpbiB0aGUgY3VycmVudCBzY29wZS5cbiAqL1xuZnVuY3Rpb24gY2FuUmVzb2x2ZUF1ZGl0VGFibGVEYXRhKG1vZGVsQ2xhc3MpIHtcbiAgaWYgKCFtb2RlbENsYXNzLmhhc1RlbmFudERhdGFiYXNlSWRlbnRpZmllclJlc29sdmVyKCkpIHtcbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgY29uc3QgdGVuYW50RGF0YWJhc2VJZGVudGlmaWVyID0gbW9kZWxDbGFzcy5nZXRUZW5hbnREYXRhYmFzZUlkZW50aWZpZXIoKVxuXG4gIGlmICghdGVuYW50RGF0YWJhc2VJZGVudGlmaWVyKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICByZXR1cm4gbW9kZWxDbGFzcy5fZ2V0Q29uZmlndXJhdGlvbigpLmlzRGF0YWJhc2VJZGVudGlmaWVyQWN0aXZlKHRlbmFudERhdGFiYXNlSWRlbnRpZmllcilcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBDcmVhdGluZyBhdWRpdHNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIENyZWF0ZXMgYW4gYXVkaXQgcm93IGZvciBhIHJlY29yZC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSByZWNvcmQgLSBSZWNvcmQgdG8gYXVkaXQuXG4gKiBAcGFyYW0ge0NyZWF0ZUF1ZGl0QXJnc30gYXJncyAtIEF1ZGl0IHJvdyBvcHRpb25zIChhY3Rpb24sIGF1ZGl0ZWRDaGFuZ2VzLCBwYXJhbXMpLlxuICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyIHwgc3RyaW5nPn0gQ3JlYXRlZCBhdWRpdCByb3cgaWQuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGNyZWF0ZUF1ZGl0KHJlY29yZCwgYXJncykge1xuICBjb25zdCBtb2RlbENsYXNzID0gLyoqIEB0eXBlIHtBdWRpdGVkTW9kZWxDbGFzc30gKi8gKHJlY29yZC5nZXRNb2RlbENsYXNzKCkpXG4gIGNvbnN0IG9wZXJhdGlvbiA9IHJlY29yZC5kYXRhYmFzZU9wZXJhdGlvbigpXG5cbiAgaWYgKG9wZXJhdGlvbikgcmV0dXJuIGF3YWl0IGNyZWF0ZUF1ZGl0V2l0aEN1cnJlbnRDb25uZWN0aW9uKHJlY29yZCwgYXJncywgbW9kZWxDbGFzcylcblxuICByZXR1cm4gYXdhaXQgbW9kZWxDbGFzcy5fZ2V0Q29uZmlndXJhdGlvbigpLmVuc3VyZUNvbm5lY3Rpb25zKHtuYW1lOiBgJHttb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpfSBhdWRpdGB9LCBhc3luYyAoKSA9PiB7XG4gICAgcmV0dXJuIGF3YWl0IGNyZWF0ZUF1ZGl0V2l0aEN1cnJlbnRDb25uZWN0aW9uKHJlY29yZCwgYXJncywgbW9kZWxDbGFzcylcbiAgfSlcbn1cblxuLyoqXG4gKiBDcmVhdGVzIGFuIGF1ZGl0IHJvdyB1c2luZyB0aGUgY3VycmVudCBtb2RlbCBkYXRhYmFzZSBjb25uZWN0aW9uLlxuICogUm91dGVzIHRvIHNoYXJlZCB0YWJsZSBvciBkZWRpY2F0ZWQgdGFibGUgYmFzZWQgb24gcmVzb2x2ZWQgYXVkaXQgdGFibGUgZGF0YS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSByZWNvcmQgLSBSZWNvcmQgdG8gYXVkaXQuXG4gKiBAcGFyYW0ge0NyZWF0ZUF1ZGl0QXJnc30gYXJncyAtIEF1ZGl0IHJvdyBvcHRpb25zIChhY3Rpb24sIGF1ZGl0ZWRDaGFuZ2VzLCBwYXJhbXMpLlxuICogQHBhcmFtIHtBdWRpdGVkTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIEF1ZGl0ZWQgbW9kZWwgY2xhc3MuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXIgfCBzdHJpbmc+fSBDcmVhdGVkIGF1ZGl0IHJvdyBpZC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gY3JlYXRlQXVkaXRXaXRoQ3VycmVudENvbm5lY3Rpb24ocmVjb3JkLCBhcmdzLCBtb2RlbENsYXNzKSB7XG4gIGlmICghcmVjb3JkLmlzUGVyc2lzdGVkKCkpIHRocm93IG5ldyBFcnJvcihgQ2Fubm90IGF1ZGl0IHVucGVyc2lzdGVkICR7bW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKX0gcmVjb3JkYClcblxuICBjb25zdCBkYiA9IHJlY29yZC5jb25uZWN0aW9uKClcbiAgY29uc3QgdGFibGVEYXRhID0gYXdhaXQgcmVzb2x2ZUF1ZGl0VGFibGVEYXRhKG1vZGVsQ2xhc3MsIGRiLCByZWNvcmQuZGF0YWJhc2VPcGVyYXRpb24oKSlcbiAgY29uc3QgYWN0aW9uID0gbm9ybWFsaXplQWN0aW9uKGFyZ3MuYWN0aW9uKVxuICBjb25zdCBhdWRpdGVkQ2hhbmdlcyA9IGFyZ3MuYXVkaXRlZENoYW5nZXMgPT09IHVuZGVmaW5lZCA/IG51bGwgOiBhcmdzLmF1ZGl0ZWRDaGFuZ2VzXG4gIGNvbnN0IHBhcmFtcyA9IGFyZ3MucGFyYW1zID09PSB1bmRlZmluZWQgPyBudWxsIDogYXJncy5wYXJhbXNcbiAgY29uc3QgY3VycmVudERhdGUgPSBuZXcgRGF0ZSgpXG4gIGNvbnN0IHJlY29yZElkID0gc2NhbGFyTW9kZWxQcmltYXJ5S2V5VmFsdWUocmVjb3JkLmlkKCksIGBBdWRpdGluZyBmb3IgJHttb2RlbENsYXNzLm5hbWV9YClcblxuICBjb25zdCBhdWRpdEFjdGlvbklkID0gYXdhaXQgZmluZE9yQ3JlYXRlTG9va3VwSWQoe1xuICAgIGNvbHVtbk5hbWU6IFwiYWN0aW9uXCIsXG4gICAgY3VycmVudERhdGUsXG4gICAgZGIsXG4gICAgdGFibGVOYW1lOiBcImF1ZGl0X2FjdGlvbnNcIixcbiAgICB2YWx1ZTogYWN0aW9uXG4gIH0pXG5cbiAgY29uc3QgYXVkaXRJZCA9IG5ldyBVVUlEKDQpLmZvcm1hdCgpXG5cbiAgaWYgKHRhYmxlRGF0YS5kZWRpY2F0ZWQpIHtcbiAgICBjb25zdCBtb2RlbEtleSA9IG1vZGVsUGFyYW1LZXkobW9kZWxDbGFzcylcblxuICAgIGF3YWl0IGRiLnF1ZXJ5KGRiLmluc2VydFNxbCh7XG4gICAgICByZXR1cm5MYXN0SW5zZXJ0ZWRDb2x1bW5OYW1lczogW1wiaWRcIl0sXG4gICAgICB0YWJsZU5hbWU6IHRhYmxlRGF0YS50YWJsZU5hbWUsXG4gICAgICBkYXRhOiB7XG4gICAgICAgIGlkOiBhdWRpdElkLFxuICAgICAgICBbYCR7bW9kZWxLZXl9X2lkYF06IHJlY29yZElkLFxuICAgICAgICBhdWRpdF9hY3Rpb25faWQ6IGF1ZGl0QWN0aW9uSWQsXG4gICAgICAgIGF1ZGl0ZWRfY2hhbmdlczogYXVkaXRlZENoYW5nZXMsXG4gICAgICAgIHBhcmFtcyxcbiAgICAgICAgY3JlYXRlZF9hdDogY3VycmVudERhdGUsXG4gICAgICAgIHVwZGF0ZWRfYXQ6IGN1cnJlbnREYXRlXG4gICAgICB9XG4gICAgfSkpXG4gIH0gZWxzZSB7XG4gICAgY29uc3QgYXVkaXRBdWRpdGFibGVUeXBlSWQgPSBhd2FpdCBmaW5kT3JDcmVhdGVMb29rdXBJZCh7XG4gICAgICBjb2x1bW5OYW1lOiBcIm5hbWVcIixcbiAgICAgIGN1cnJlbnREYXRlLFxuICAgICAgZGIsXG4gICAgICB0YWJsZU5hbWU6IFwiYXVkaXRfYXVkaXRhYmxlX3R5cGVzXCIsXG4gICAgICB2YWx1ZTogbW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKVxuICAgIH0pXG5cbiAgICBhd2FpdCBkYi5xdWVyeShkYi5pbnNlcnRTcWwoe1xuICAgICAgcmV0dXJuTGFzdEluc2VydGVkQ29sdW1uTmFtZXM6IFtcImlkXCJdLFxuICAgICAgdGFibGVOYW1lOiBcImF1ZGl0c1wiLFxuICAgICAgZGF0YToge1xuICAgICAgICBpZDogYXVkaXRJZCxcbiAgICAgICAgYXVkaXRfYWN0aW9uX2lkOiBhdWRpdEFjdGlvbklkLFxuICAgICAgICBhdWRpdF9hdWRpdGFibGVfdHlwZV9pZDogYXVkaXRBdWRpdGFibGVUeXBlSWQsXG4gICAgICAgIGF1ZGl0YWJsZV9pZDogcmVjb3JkSWQsXG4gICAgICAgIGF1ZGl0YWJsZV90eXBlOiBtb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpLFxuICAgICAgICBhdWRpdGVkX2NoYW5nZXM6IGF1ZGl0ZWRDaGFuZ2VzLFxuICAgICAgICBwYXJhbXMsXG4gICAgICAgIGNyZWF0ZWRfYXQ6IGN1cnJlbnREYXRlLFxuICAgICAgICB1cGRhdGVkX2F0OiBjdXJyZW50RGF0ZVxuICAgICAgfVxuICAgIH0pKVxuICB9XG5cbiAgYXdhaXQgZW1pdEF1ZGl0RXZlbnQobW9kZWxDbGFzcywgYWN0aW9uLCB7XG4gICAgYWN0aW9uLFxuICAgIGF1ZGl0SWQsXG4gICAgYXVkaXRlZENoYW5nZXMsXG4gICAgcGFyYW1zLFxuICAgIHJlY29yZFxuICB9KVxuXG4gIEF1ZGl0RXZlbnRzLmNhbGwobW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKSwgYWN0aW9uLCB7XG4gICAgYWN0aW9uLFxuICAgIGF1ZGl0SWQsXG4gICAgYXVkaXRlZENoYW5nZXMsXG4gICAgcGFyYW1zLFxuICAgIHJlY29yZFxuICB9KVxuXG4gIHJldHVybiBhdWRpdElkXG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gTGlmZWN5Y2xlIGNhbGxiYWNrc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogQ2FwdHVyZXMgY3JlYXRlIGNoYW5nZXMgYmVmb3JlIHBlcnNpc3RlbmNlIGNsZWFycyB0aGUgY2hhbmdlIHNldC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0ICYge19wZW5kaW5nQ3JlYXRlQXVkaXRDaGFuZ2VzPzogQXVkaXRDaGFuZ2VzfX0gcmVjb3JkIC0gUmVjb3JkIHdob3NlIHBlbmRpbmcgY2hhbmdlcyBzaG91bGQgYmUgY2FwdHVyZWQuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gY2FwdHVyZUNyZWF0ZUF1ZGl0Q2hhbmdlcyhyZWNvcmQpIHtcbiAgcmVjb3JkLl9wZW5kaW5nQ3JlYXRlQXVkaXRDaGFuZ2VzID0gYXVkaXRDaGFuZ2VzRm9yQ3VycmVudENoYW5nZXMocmVjb3JkKVxufVxuXG4vKipcbiAqIFdyaXRlcyB0aGUgY3JlYXRlIGF1ZGl0IHJvdyBmb3IgYSBtb2RlbCBpbnN0YW5jZS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0ICYge19wZW5kaW5nQ3JlYXRlQXVkaXRDaGFuZ2VzPzogQXVkaXRDaGFuZ2VzfX0gcmVjb3JkIC0gUmVjb3JkIHRvIGF1ZGl0LlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGNyZWF0ZUNyZWF0ZUF1ZGl0KHJlY29yZCkge1xuICBhd2FpdCBjcmVhdGVBdWRpdChyZWNvcmQsIHtcbiAgICBhY3Rpb246IFwiY3JlYXRlXCIsXG4gICAgYXVkaXRlZENoYW5nZXM6IHJlY29yZC5fcGVuZGluZ0NyZWF0ZUF1ZGl0Q2hhbmdlcyB8fCBudWxsXG4gIH0pXG5cbiAgcmVjb3JkLl9wZW5kaW5nQ3JlYXRlQXVkaXRDaGFuZ2VzID0gdW5kZWZpbmVkXG59XG5cbi8qKlxuICogQ2FwdHVyZXMgdXBkYXRlIGNoYW5nZXMgYmVmb3JlIHBlcnNpc3RlbmNlIGNsZWFycyB0aGUgY2hhbmdlIHNldC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0ICYge19wZW5kaW5nVXBkYXRlQXVkaXRDaGFuZ2VzPzogQXVkaXRDaGFuZ2VzfX0gcmVjb3JkIC0gUmVjb3JkIHdob3NlIHBlbmRpbmcgY2hhbmdlcyBzaG91bGQgYmUgY2FwdHVyZWQuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gY2FwdHVyZVVwZGF0ZUF1ZGl0Q2hhbmdlcyhyZWNvcmQpIHtcbiAgcmVjb3JkLl9wZW5kaW5nVXBkYXRlQXVkaXRDaGFuZ2VzID0gYXVkaXRDaGFuZ2VzRm9yQ3VycmVudENoYW5nZXMocmVjb3JkKVxufVxuXG4vKipcbiAqIFdyaXRlcyB0aGUgdXBkYXRlIGF1ZGl0IHJvdyBmb3IgYSBtb2RlbCBpbnN0YW5jZS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0ICYge19wZW5kaW5nVXBkYXRlQXVkaXRDaGFuZ2VzPzogQXVkaXRDaGFuZ2VzfX0gcmVjb3JkIC0gUmVjb3JkIHRvIGF1ZGl0LlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGNyZWF0ZVVwZGF0ZUF1ZGl0KHJlY29yZCkge1xuICBjb25zdCBhdWRpdGVkQ2hhbmdlcyA9IHJlY29yZC5fcGVuZGluZ1VwZGF0ZUF1ZGl0Q2hhbmdlcyB8fCBudWxsXG5cbiAgcmVjb3JkLl9wZW5kaW5nVXBkYXRlQXVkaXRDaGFuZ2VzID0gdW5kZWZpbmVkXG5cbiAgaWYgKCFhdWRpdGVkQ2hhbmdlcyB8fCBPYmplY3Qua2V5cyhhdWRpdGVkQ2hhbmdlcykubGVuZ3RoIDw9IDApIHJldHVyblxuXG4gIGF3YWl0IGNyZWF0ZUF1ZGl0KHJlY29yZCwge1xuICAgIGFjdGlvbjogXCJ1cGRhdGVcIixcbiAgICBhdWRpdGVkQ2hhbmdlc1xuICB9KVxufVxuXG4vKipcbiAqIFdyaXRlcyB0aGUgZGVzdHJveSBhdWRpdCByb3cgZm9yIGEgbW9kZWwgaW5zdGFuY2UuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gcmVjb3JkIC0gUmVjb3JkIHRvIGF1ZGl0LlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGNyZWF0ZURlc3Ryb3lBdWRpdChyZWNvcmQpIHtcbiAgYXdhaXQgY3JlYXRlQXVkaXQocmVjb3JkLCB7XG4gICAgYWN0aW9uOiBcImRlc3Ryb3lcIixcbiAgICBhdWRpdGVkQ2hhbmdlczogYXVkaXRDaGFuZ2VzRm9yRGVzdHJveShyZWNvcmQpXG4gIH0pXG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gQ2hhbmdlcyBoZWxwZXJzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBDYXB0dXJlcyB0aGUgbmV3IHZhbHVlcyBmb3IgZmllbGRzIGNoYW5nZWQgb24gYSByZWNvcmQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gcmVjb3JkIC0gUmVjb3JkIHdob3NlIHBlbmRpbmcgY2hhbmdlcyBzaG91bGQgYmUgY2FwdHVyZWQuXG4gKiBAcmV0dXJucyB7QXVkaXRDaGFuZ2VzfSBOZXcgdmFsdWVzIGtleWVkIGJ5IGF0dHJpYnV0ZSBuYW1lLlxuICovXG5mdW5jdGlvbiBhdWRpdENoYW5nZXNGb3JDdXJyZW50Q2hhbmdlcyhyZWNvcmQpIHtcbiAgY29uc3QgY2hhbmdlcyA9IHJlY29yZC5jaGFuZ2VzKClcbiAgLyoqIEB0eXBlIHtBdWRpdENoYW5nZXN9ICovXG4gIGNvbnN0IGF1ZGl0ZWRDaGFuZ2VzID0ge31cbiAgY29uc3QgY29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZSA9IHJlY29yZC5nZXRNb2RlbENsYXNzKCkuZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCgpXG5cbiAgZm9yIChjb25zdCBbYXR0cmlidXRlTmFtZSwgY2hhbmdlXSBvZiBPYmplY3QuZW50cmllcyhjaGFuZ2VzKSkge1xuICAgIGF1ZGl0ZWRDaGFuZ2VzW2NvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVbYXR0cmlidXRlTmFtZV0gfHwgYXR0cmlidXRlTmFtZV0gPSBjaGFuZ2VbMV1cbiAgfVxuXG4gIHJldHVybiBhdWRpdGVkQ2hhbmdlc1xufVxuXG4vKipcbiAqIENhcHR1cmVzIHRoZSBjdXJyZW50IGF0dHJpYnV0ZXMgZm9yIGEgZGVzdHJveSBhdWRpdC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSByZWNvcmQgLSBSZWNvcmQgYmVpbmcgZGVzdHJveWVkLlxuICogQHJldHVybnMge0F1ZGl0Q2hhbmdlc30gQ3VycmVudCBhdHRyaWJ1dGVzIGtleWVkIGJ5IGF0dHJpYnV0ZSBuYW1lLlxuICovXG5mdW5jdGlvbiBhdWRpdENoYW5nZXNGb3JEZXN0cm95KHJlY29yZCkge1xuICByZXR1cm4gey4uLnJlY29yZC5hdHRyaWJ1dGVzKCl9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gd2l0aG91dEF1ZGl0XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBSZXR1cm5zIHJlY29yZHMgd2l0aG91dCBhbiBhdWRpdCByb3cgZm9yIHRoZSBnaXZlbiBhY3Rpb24uXG4gKiBVc2VzIHNoYXJlZC10YWJsZSBkZWZhdWx0cyB3aGVuIHRhYmxlIGRhdGEgaXMgbm90IHlldCByZXNvbHZlZDtcbiAqIHN3aXRjaGVzIHRvIHRoZSBkZWRpY2F0ZWQgdGFibGUgcGF0aCBvbmNlIHJlc29sdmVkLlxuICogQHRlbXBsYXRlIHtBdWRpdGVkTW9kZWxDbGFzc30gTUNcbiAqIEBwYXJhbSB7TUN9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcyB0byBzY29wZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhY3Rpb24gLSBBdWRpdCBhY3Rpb24gdG8gZXhjbHVkZS5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PE1DPn0gUXVlcnkgc2NvcGVkIHRvIHJlY29yZHMgd2l0aG91dCB0aGF0IGF1ZGl0IGFjdGlvbi5cbiAqL1xuZnVuY3Rpb24gd2l0aG91dEF1ZGl0KG1vZGVsQ2xhc3MsIGFjdGlvbikge1xuICBjb25zdCBkYiA9IG1vZGVsQ2xhc3MuY29ubmVjdGlvbigpXG4gIGNvbnN0IGRhdGFiYXNlSWRlbnRpdHkgPSBhdWRpdERhdGFiYXNlSWRlbnRpdHkobW9kZWxDbGFzcywgZGIpXG4gIGNvbnN0IHRhYmxlRGF0YSA9IGF1ZGl0VGFibGVEYXRhQnlNb2RlbC5nZXQobW9kZWxDbGFzcyk/LmdldChkYXRhYmFzZUlkZW50aXR5KVxuICBjb25zdCBtb2RlbFRhYmxlU3FsID0gZGIucXVvdGVUYWJsZShtb2RlbENsYXNzLnRhYmxlTmFtZSgpKVxuICBjb25zdCBhdWRpdEFjdGlvbnNUYWJsZVNxbCA9IGRiLnF1b3RlVGFibGUoXCJhdWRpdF9hY3Rpb25zXCIpXG4gIGNvbnN0IHByaW1hcnlLZXkgPSBzY2FsYXJNb2RlbFByaW1hcnlLZXkobW9kZWxDbGFzcy5wcmltYXJ5S2V5KCksIGB3aXRob3V0QXVkaXQgZm9yICR7bW9kZWxDbGFzcy5uYW1lfWApXG4gIGNvbnN0IG1vZGVsUHJpbWFyeUtleVNxbCA9IGAke21vZGVsVGFibGVTcWx9LiR7ZGIucXVvdGVDb2x1bW4ocHJpbWFyeUtleSl9YFxuICBjb25zdCBhdWRpdEFjdGlvbnNJZFNxbCA9IGAke2F1ZGl0QWN0aW9uc1RhYmxlU3FsfS4ke2RiLnF1b3RlQ29sdW1uKFwiaWRcIil9YFxuICBjb25zdCBhdWRpdEFjdGlvbnNBY3Rpb25TcWwgPSBgJHthdWRpdEFjdGlvbnNUYWJsZVNxbH0uJHtkYi5xdW90ZUNvbHVtbihcImFjdGlvblwiKX1gXG5cbiAgaWYgKHRhYmxlRGF0YT8uZGVkaWNhdGVkKSB7XG4gICAgY29uc3QgbW9kZWxLZXkgPSBtb2RlbFBhcmFtS2V5KG1vZGVsQ2xhc3MpXG4gICAgY29uc3QgYXVkaXRzVGFibGVTcWwgPSBkYi5xdW90ZVRhYmxlKHRhYmxlRGF0YS50YWJsZU5hbWUpXG4gICAgY29uc3QgYXVkaXRBY3Rpb25JZFNxbCA9IGAke2F1ZGl0c1RhYmxlU3FsfS4ke2RiLnF1b3RlQ29sdW1uKFwiYXVkaXRfYWN0aW9uX2lkXCIpfWBcbiAgICBjb25zdCBtb2RlbElkU3FsID0gYCR7YXVkaXRzVGFibGVTcWx9LiR7ZGIucXVvdGVDb2x1bW4oYCR7bW9kZWxLZXl9X2lkYCl9YFxuXG4gICAgcmV0dXJuIG1vZGVsQ2xhc3NcbiAgICAgIC5hbGwoKVxuICAgICAgLndoZXJlKGBcbiAgICAgICAgTk9UIEVYSVNUUyAoXG4gICAgICAgICAgU0VMRUNUIDFcbiAgICAgICAgICBGUk9NICR7YXVkaXRzVGFibGVTcWx9XG4gICAgICAgICAgSU5ORVIgSk9JTiAke2F1ZGl0QWN0aW9uc1RhYmxlU3FsfVxuICAgICAgICAgICAgT04gJHthdWRpdEFjdGlvbnNJZFNxbH0gPSAke2F1ZGl0QWN0aW9uSWRTcWx9XG4gICAgICAgICAgV0hFUkUgJHttb2RlbElkU3FsfSA9ICR7bW9kZWxQcmltYXJ5S2V5U3FsfVxuICAgICAgICAgICAgQU5EICR7YXVkaXRBY3Rpb25zQWN0aW9uU3FsfSA9ICR7ZGIucXVvdGUobm9ybWFsaXplQWN0aW9uKGFjdGlvbikpfVxuICAgICAgICApXG4gICAgICBgKVxuICB9XG5cbiAgY29uc3QgYXVkaXRzVGFibGVTcWwgPSBkYi5xdW90ZVRhYmxlKFwiYXVkaXRzXCIpXG4gIGNvbnN0IGF1ZGl0QXVkaXRhYmxlSWRTcWwgPSBgJHthdWRpdHNUYWJsZVNxbH0uJHtkYi5xdW90ZUNvbHVtbihcImF1ZGl0YWJsZV9pZFwiKX1gXG4gIGNvbnN0IGF1ZGl0QXVkaXRhYmxlVHlwZVNxbCA9IGAke2F1ZGl0c1RhYmxlU3FsfS4ke2RiLnF1b3RlQ29sdW1uKFwiYXVkaXRhYmxlX3R5cGVcIil9YFxuICBjb25zdCBhdWRpdEFjdGlvbklkU3FsID0gYCR7YXVkaXRzVGFibGVTcWx9LiR7ZGIucXVvdGVDb2x1bW4oXCJhdWRpdF9hY3Rpb25faWRcIil9YFxuXG4gIHJldHVybiBtb2RlbENsYXNzXG4gICAgLmFsbCgpXG4gICAgLndoZXJlKGBcbiAgICAgIE5PVCBFWElTVFMgKFxuICAgICAgICBTRUxFQ1QgMVxuICAgICAgICBGUk9NICR7YXVkaXRzVGFibGVTcWx9XG4gICAgICAgIElOTkVSIEpPSU4gJHthdWRpdEFjdGlvbnNUYWJsZVNxbH1cbiAgICAgICAgICBPTiAke2F1ZGl0QWN0aW9uc0lkU3FsfSA9ICR7YXVkaXRBY3Rpb25JZFNxbH1cbiAgICAgICAgV0hFUkUgJHthdWRpdEF1ZGl0YWJsZVR5cGVTcWx9ID0gJHtkYi5xdW90ZShtb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpKX1cbiAgICAgICAgICBBTkQgJHthdWRpdEF1ZGl0YWJsZUlkU3FsfSA9ICR7bW9kZWxQcmltYXJ5S2V5U3FsfVxuICAgICAgICAgIEFORCAke2F1ZGl0QWN0aW9uc0FjdGlvblNxbH0gPSAke2RiLnF1b3RlKG5vcm1hbGl6ZUFjdGlvbihhY3Rpb24pKX1cbiAgICAgIClcbiAgICBgKVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEV2ZW50IGNhbGxiYWNrc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogUmVnaXN0ZXJzIGEgcGVyLW1vZGVsIGNhbGxiYWNrIGZpcmVkIGFmdGVyIGFuIGF1ZGl0IHJvdyBpcyBjcmVhdGVkLlxuICogQHBhcmFtIHtBdWRpdGVkTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzIHRvIG9ic2VydmUuXG4gKiBAcGFyYW0ge3N0cmluZ30gYWN0aW9uIC0gQXVkaXQgYWN0aW9uIG5hbWUgKGUuZy4gXCJjcmVhdGVcIikuXG4gKiBAcGFyYW0ge0F1ZGl0Q2FsbGJhY2t9IGNhbGxiYWNrIC0gQ2FsbGJhY2sgaW52b2tlZCBhZnRlciBtYXRjaGluZyBhdWRpdCByb3dzIGFyZSBjcmVhdGVkLlxuICogQHJldHVybnMgeygpID0+IHZvaWR9IFVuc3Vic2NyaWJlIGZ1bmN0aW9uLlxuICovXG5mdW5jdGlvbiByZWdpc3RlckF1ZGl0Q2FsbGJhY2sobW9kZWxDbGFzcywgYWN0aW9uLCBjYWxsYmFjaykge1xuICBjb25zdCBub3JtYWxpemVkQWN0aW9uID0gbm9ybWFsaXplQWN0aW9uKGFjdGlvbilcbiAgY29uc3QgY2FsbGJhY2tzID0gYXVkaXRDYWxsYmFja3NGb3JNb2RlbENsYXNzKG1vZGVsQ2xhc3MpXG5cbiAgaWYgKCFjYWxsYmFja3Nbbm9ybWFsaXplZEFjdGlvbl0pIHtcbiAgICBjYWxsYmFja3Nbbm9ybWFsaXplZEFjdGlvbl0gPSBbXVxuICB9XG5cbiAgY2FsbGJhY2tzW25vcm1hbGl6ZWRBY3Rpb25dLnB1c2goY2FsbGJhY2spXG5cbiAgcmV0dXJuICgpID0+IHtcbiAgICBjb25zdCBhY3Rpb25DYWxsYmFja3MgPSBjYWxsYmFja3Nbbm9ybWFsaXplZEFjdGlvbl1cbiAgICBjb25zdCBpbmRleCA9IGFjdGlvbkNhbGxiYWNrcy5pbmRleE9mKGNhbGxiYWNrKVxuXG4gICAgaWYgKGluZGV4ID49IDApIHtcbiAgICAgIGFjdGlvbkNhbGxiYWNrcy5zcGxpY2UoaW5kZXgsIDEpXG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogRW1pdHMgcGVyLW1vZGVsIGF1ZGl0IGNhbGxiYWNrcyBmb3IgYSBtb2RlbC9hY3Rpb24gcGFpci5cbiAqIEBwYXJhbSB7QXVkaXRlZE1vZGVsQ2xhc3N9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhY3Rpb24gLSBBdWRpdCBhY3Rpb24uXG4gKiBAcGFyYW0ge0F1ZGl0RXZlbnRQYXlsb2FkfSBwYXlsb2FkIC0gRXZlbnQgcGF5bG9hZC5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICovXG5hc3luYyBmdW5jdGlvbiBlbWl0QXVkaXRFdmVudChtb2RlbENsYXNzLCBhY3Rpb24sIHBheWxvYWQpIHtcbiAgY29uc3QgY2FsbGJhY2tzID0gYXVkaXRDYWxsYmFja3NGb3JNb2RlbENsYXNzKG1vZGVsQ2xhc3MpW2FjdGlvbl0gfHwgW11cblxuICBmb3IgKGNvbnN0IGNhbGxiYWNrIG9mIFsuLi5jYWxsYmFja3NdKSB7XG4gICAgYXdhaXQgY2FsbGJhY2socGF5bG9hZClcbiAgfVxufVxuXG4vKipcbiAqIFJldHVybnMgdGhlIHBlci1tb2RlbCBjYWxsYmFjayBtYXAuXG4gKiBAcGFyYW0ge0F1ZGl0ZWRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gKiBAcmV0dXJucyB7UmVjb3JkPHN0cmluZywgQXVkaXRDYWxsYmFja1tdPn0gQ2FsbGJhY2sgbWFwIGtleWVkIGJ5IGFjdGlvbi5cbiAqL1xuZnVuY3Rpb24gYXVkaXRDYWxsYmFja3NGb3JNb2RlbENsYXNzKG1vZGVsQ2xhc3MpIHtcbiAgaWYgKCFPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwobW9kZWxDbGFzcywgXCJfYXVkaXRDYWxsYmFja3NcIikpIHtcbiAgICBtb2RlbENsYXNzLl9hdWRpdENhbGxiYWNrcyA9IHt9XG4gIH1cblxuICBjb25zdCBjYWxsYmFja3MgPSBtb2RlbENsYXNzLl9hdWRpdENhbGxiYWNrc1xuXG4gIGlmICghY2FsbGJhY2tzKSB0aHJvdyBuZXcgRXJyb3IoYEF1ZGl0IGNhbGxiYWNrcyB3ZXJlbid0IGluaXRpYWxpemVkIGZvciAke21vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCl9YClcblxuICByZXR1cm4gY2FsbGJhY2tzXG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gTG9va3VwIGhlbHBlcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIEZpbmRzIG9yIGNyZWF0ZXMgYSBsb29rdXAgcm93IGFuZCByZXR1cm5zIGl0cyBpZC5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jb2x1bW5OYW1lIC0gTG9va3VwIHZhbHVlIGNvbHVtbiBuYW1lLlxuICogQHBhcmFtIHtEYXRlfSBhcmdzLmN1cnJlbnREYXRlIC0gVGltZXN0YW1wIHRvIHdyaXRlIHdoZW4gaW5zZXJ0aW5nLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5kYiAtIERhdGFiYXNlIGRyaXZlci5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnRhYmxlTmFtZSAtIExvb2t1cCB0YWJsZSBuYW1lLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudmFsdWUgLSBMb29rdXAgdmFsdWUuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXIgfCBzdHJpbmc+fSBMb29rdXAgcm93IGlkLlxuICovXG5hc3luYyBmdW5jdGlvbiBmaW5kT3JDcmVhdGVMb29rdXBJZCh7Y29sdW1uTmFtZSwgY3VycmVudERhdGUsIGRiLCB0YWJsZU5hbWUsIHZhbHVlfSkge1xuICBhd2FpdCBkYi51cHNlcnQoe1xuICAgIHRhYmxlTmFtZSxcbiAgICBjb25mbGljdENvbHVtbnM6IFtjb2x1bW5OYW1lXSxcbiAgICB1cGRhdGVDb2x1bW5zOiBbY29sdW1uTmFtZV0sXG4gICAgZGF0YToge1xuICAgICAgaWQ6IG5ldyBVVUlEKDQpLmZvcm1hdCgpLFxuICAgICAgW2NvbHVtbk5hbWVdOiB2YWx1ZSxcbiAgICAgIGNyZWF0ZWRfYXQ6IGN1cnJlbnREYXRlLFxuICAgICAgdXBkYXRlZF9hdDogY3VycmVudERhdGVcbiAgICB9XG4gIH0pXG5cbiAgY29uc3QgaWQgPSBhd2FpdCBmaW5kTG9va3VwSWQoe2NvbHVtbk5hbWUsIGRiLCB0YWJsZU5hbWUsIHZhbHVlfSlcblxuICBpZiAoaWQgPT09IG51bGwpIHRocm93IG5ldyBFcnJvcihgQ291bGRuJ3QgZmluZCAke3RhYmxlTmFtZX0uJHtjb2x1bW5OYW1lfSBhZnRlciB1cHNlcnRgKVxuXG4gIHJldHVybiBpZFxufVxuXG4vKipcbiAqIEZpbmRzIGEgbG9va3VwIGlkIGJ5IHZhbHVlLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbHVtbk5hbWUgLSBMb29rdXAgdmFsdWUgY29sdW1uIG5hbWUuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLmRiIC0gRGF0YWJhc2UgZHJpdmVyLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudGFibGVOYW1lIC0gTG9va3VwIHRhYmxlIG5hbWUuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy52YWx1ZSAtIExvb2t1cCB2YWx1ZS5cbiAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlciB8IHN0cmluZyB8IG51bGw+fSBMb29rdXAgcm93IGlkIG9yIG51bGwuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGZpbmRMb29rdXBJZCh7Y29sdW1uTmFtZSwgZGIsIHRhYmxlTmFtZSwgdmFsdWV9KSB7XG4gIGNvbnN0IHJvd3MgPSAvKiogQHR5cGUge0FycmF5PHtpZDogbnVtYmVyIHwgc3RyaW5nfT59ICovIChhd2FpdCBkYi5xdWVyeShgXG4gICAgU0VMRUNUICR7ZGIucXVvdGVDb2x1bW4oXCJpZFwiKX0gQVMgaWRcbiAgICBGUk9NICR7ZGIucXVvdGVUYWJsZSh0YWJsZU5hbWUpfVxuICAgIFdIRVJFICR7ZGIucXVvdGVDb2x1bW4oY29sdW1uTmFtZSl9ID0gJHtkYi5xdW90ZSh2YWx1ZSl9XG4gIGApKVxuXG4gIGlmIChyb3dzWzBdKSByZXR1cm4gcm93c1swXS5pZFxuXG4gIHJldHVybiBudWxsXG59XG5cbi8qKlxuICogTm9ybWFsaXplcyBhbiBhdWRpdCBhY3Rpb24gc3RyaW5nLlxuICogQHBhcmFtIHtzdHJpbmd9IGFjdGlvbiAtIEFjdGlvbiBuYW1lLlxuICogQHJldHVybnMge3N0cmluZ30gVHJpbW1lZCwgbm9uLWVtcHR5IGFjdGlvbiBuYW1lLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVBY3Rpb24oYWN0aW9uKSB7XG4gIGNvbnN0IG5vcm1hbGl6ZWRBY3Rpb24gPSBhY3Rpb24udHJpbSgpXG5cbiAgaWYgKCFub3JtYWxpemVkQWN0aW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJBdWRpdCBhY3Rpb24gbXVzdCBiZSBwcmVzZW50XCIpXG5cbiAgcmV0dXJuIG5vcm1hbGl6ZWRBY3Rpb25cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBNaWdyYXRpb24gaGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogQ3JlYXRlcyB0aGUgc2hhcmVkIGF1ZGl0IHRhYmxlcyBtaWdyYXRpb24gdXAvZG93biBjYWxsYmFja3MgZm9yIHVzZSBpbnNpZGVcbiAqIGEgTWlncmF0aW9uIGNsYXNzLiBUaGUgYHRhYmxlYCBwYXJhbWV0ZXIgaXMgYSBNaWdyYXRpb24gaW5zdGFuY2UuXG4gKiBAcGFyYW0ge3tpZD86IHt0eXBlOiBzdHJpbmd9fX0gW29wdGlvbnNdIC0gSUQgY29sdW1uIG9wdGlvbnMuXG4gKiBAcmV0dXJucyB7e2Rvd246ICh0YWJsZTogaW1wb3J0KFwiLi4vbWlncmF0aW9uL2luZGV4LmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8dm9pZD4sIHVwOiAodGFibGU6IGltcG9ydChcIi4uL21pZ3JhdGlvbi9pbmRleC5qc1wiKS5kZWZhdWx0KSA9PiBQcm9taXNlPHZvaWQ+fX0gLSBVcC9kb3duIGNhbGxiYWNrcyBmb3IgdGhlIHNoYXJlZCBhdWRpdCB0YWJsZXMuXG4gKi9cbmZ1bmN0aW9uIGNyZWF0ZVNoYXJlZEF1ZGl0VGFibGVzTWlncmF0aW9uKG9wdGlvbnMgPSB7fSkge1xuICBjb25zdCBvcHRzID0gLyoqIEB0eXBlIHt7aWQ/OiB7dHlwZTogc3RyaW5nfX19ICovIChvcHRpb25zKVxuICBjb25zdCBpZE9wdGlvbnMgPSAvKiogQHR5cGUge3t0eXBlPzogc3RyaW5nfX0gKi8gKG9wdHMuaWQgfHwge30pXG4gIGNvbnN0IHR5cGUgPSBpZE9wdGlvbnMudHlwZVxuXG4gIHJldHVybiB7XG4gICAgYXN5bmMgdXAodGFibGUpIHtcbiAgICAgIGF3YWl0IHRhYmxlLmNyZWF0ZVRhYmxlKFwiYXVkaXRfYWN0aW9uc1wiLCB7aWQ6IC8qKiBAdHlwZSB7e3R5cGU/OiBzdHJpbmd9fSAqLyAob3B0cy5pZCB8fCB7fSl9LCAoLyoqIEB0eXBlIHt7c3RyaW5nKG5hbWU6IHN0cmluZywgb3B0aW9uczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiB2b2lkLCB0aW1lc3RhbXBzKCk6IHZvaWR9fSAqLyB0KSA9PiB7XG4gICAgICAgIHQuc3RyaW5nKFwiYWN0aW9uXCIsIHtpbmRleDoge3VuaXF1ZTogdHJ1ZX0sIG51bGw6IGZhbHNlfSlcbiAgICAgICAgdC50aW1lc3RhbXBzKClcbiAgICAgIH0pXG5cbiAgICAgIGF3YWl0IHRhYmxlLmNyZWF0ZVRhYmxlKFwiYXVkaXRfYXVkaXRhYmxlX3R5cGVzXCIsIHtpZDogLyoqIEB0eXBlIHt7dHlwZT86IHN0cmluZ319ICovIChvcHRzLmlkIHx8IHt9KX0sICgvKiogQHR5cGUge3tzdHJpbmcobmFtZTogc3RyaW5nLCBvcHRpb25zOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHZvaWQsIHRpbWVzdGFtcHMoKTogdm9pZH19ICovIHQpID0+IHtcbiAgICAgICAgdC5zdHJpbmcoXCJuYW1lXCIsIHtpbmRleDoge3VuaXF1ZTogdHJ1ZX0sIG51bGw6IGZhbHNlfSlcbiAgICAgICAgdC50aW1lc3RhbXBzKClcbiAgICAgIH0pXG5cbiAgICAgIGF3YWl0IHRhYmxlLmNyZWF0ZVRhYmxlKFwiYXVkaXRzXCIsIHtpZDogLyoqIEB0eXBlIHt7dHlwZT86IHN0cmluZ319ICovIChvcHRzLmlkIHx8IHt9KX0sICgvKiogQHR5cGUge3tqc29uKG5hbWU6IHN0cmluZyk6IHZvaWQsIHJlZmVyZW5jZXMobmFtZTogc3RyaW5nLCBvcHRpb25zOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHZvaWQsIHRpbWVzdGFtcHMoKTogdm9pZH19ICovIHQpID0+IHtcbiAgICAgICAgdC5yZWZlcmVuY2VzKFwiYXVkaXRfYWN0aW9uXCIsIHtmb3JlaWduS2V5OiB0cnVlLCBudWxsOiBmYWxzZSwgdHlwZX0pXG4gICAgICAgIHQucmVmZXJlbmNlcyhcImF1ZGl0X2F1ZGl0YWJsZV90eXBlXCIsIHtmb3JlaWduS2V5OiB0cnVlLCBudWxsOiBmYWxzZSwgdHlwZX0pXG4gICAgICAgIHQucmVmZXJlbmNlcyhcImF1ZGl0YWJsZVwiLCB7bnVsbDogZmFsc2UsIHBvbHltb3JwaGljOiB0cnVlLCB0eXBlfSlcbiAgICAgICAgdC5qc29uKFwiYXVkaXRlZF9jaGFuZ2VzXCIpXG4gICAgICAgIHQuanNvbihcInBhcmFtc1wiKVxuICAgICAgICB0LnRpbWVzdGFtcHMoKVxuICAgICAgfSlcbiAgICB9LFxuXG4gICAgYXN5bmMgZG93bih0YWJsZSkge1xuICAgICAgYXdhaXQgdGFibGUuZHJvcFRhYmxlKFwiYXVkaXRzXCIpXG4gICAgICBhd2FpdCB0YWJsZS5kcm9wVGFibGUoXCJhdWRpdF9hdWRpdGFibGVfdHlwZXNcIilcbiAgICAgIGF3YWl0IHRhYmxlLmRyb3BUYWJsZShcImF1ZGl0X2FjdGlvbnNcIilcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBSZXR1cm5zIHRoZSBkZWRpY2F0ZWQgYXVkaXQgdGFibGUgbmFtZSBmb3IgYSBnaXZlbiBtb2RlbCB0YWJsZSBuYW1lLlxuICogQHBhcmFtIHtzdHJpbmd9IG1vZGVsVGFibGVOYW1lIC0gTW9kZWwgdGFibGUgbmFtZSAoZS5nLiBcInByb2plY3RzXCIpLlxuICogQHJldHVybnMge3N0cmluZ30gRGVkaWNhdGVkIGF1ZGl0IHRhYmxlIG5hbWUgKGUuZy4gXCJwcm9qZWN0X2F1ZGl0c1wiKS5cbiAqL1xuZnVuY3Rpb24gZGVkaWNhdGVkQXVkaXRUYWJsZU5hbWVGb3JUYWJsZShtb2RlbFRhYmxlTmFtZSkge1xuICBpZiAobW9kZWxUYWJsZU5hbWUuZW5kc1dpdGgoXCJzXCIpKSB7XG4gICAgcmV0dXJuIGAke21vZGVsVGFibGVOYW1lLnNsaWNlKDAsIC0xKX1fYXVkaXRzYFxuICB9XG5cbiAgcmV0dXJuIGAke21vZGVsVGFibGVOYW1lfV9hdWRpdHNgXG59XG5cbmV4cG9ydCB7XG4gIEF1ZGl0RXZlbnRzLFxuICBjYXB0dXJlQ3JlYXRlQXVkaXRDaGFuZ2VzLFxuICBjYXB0dXJlVXBkYXRlQXVkaXRDaGFuZ2VzLFxuICBjcmVhdGVBdWRpdCxcbiAgY3JlYXRlQ3JlYXRlQXVkaXQsXG4gIGNyZWF0ZURlc3Ryb3lBdWRpdCxcbiAgY3JlYXRlVXBkYXRlQXVkaXQsXG4gIGNyZWF0ZVNoYXJlZEF1ZGl0VGFibGVzTWlncmF0aW9uLFxuICBkZWRpY2F0ZWRBdWRpdFRhYmxlTmFtZUZvclRhYmxlLFxuICBpbml0aWFsaXplQXVkaXRlZE1vZGVsUmVsYXRpb25zaGlwcyxcbiAgaW5pdGlhbGl6ZUF1ZGl0aW5nLFxuICByZWdpc3RlckF1ZGl0Q2FsbGJhY2ssXG4gIHJlZ2lzdGVyQXVkaXRpbmcsXG4gIHdpdGhvdXRBdWRpdFxufVxuIl19