// @ts-check
import UUID from "pure-uuid";
import HasManyRelationship from "./relationships/has-many.js";
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
                [`${modelKey}_id`]: record.id(),
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
                auditable_id: record.id(),
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
    const modelPrimaryKeySql = `${modelTableSql}.${db.quoteColumn(modelClass.primaryKey())}`;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXVkaXRpbmcuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcmVjb3JkL2F1ZGl0aW5nLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFDNUIsT0FBTyxtQkFBbUIsTUFBTSw2QkFBNkIsQ0FBQTtBQUU3RDs7Ozs7O0dBTUc7QUFDSDs7O0dBR0c7QUFFSDs7Ozs7Ozs7R0FRRztBQUVIOzs7R0FHRztBQUVIOzs7Ozs7R0FNRztBQUVIOzs7Ozs7OztHQVFHO0FBRUg7Ozs7Ozs7R0FPRztBQUVILHNGQUFzRjtBQUN0RixNQUFNLGtDQUFrQyxHQUFHLElBQUksT0FBTyxFQUFFLENBQUE7QUFFeEQsc0VBQXNFO0FBQ3RFLE1BQU0scUJBQXFCLEdBQUcsSUFBSSxPQUFPLEVBQUUsQ0FBQTtBQUUzQywrREFBK0Q7QUFDL0QsTUFBTSxlQUFlLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtBQUVqQyxNQUFNLDJCQUEyQixHQUFHLElBQUksT0FBTyxFQUFFLENBQUE7QUFFakQsMkVBQTJFO0FBQzNFLE1BQU0seUJBQXlCLEdBQUcsSUFBSSxPQUFPLEVBQUUsQ0FBQTtBQUUvQyw4RUFBOEU7QUFDOUUsd0RBQXdEO0FBQ3hELDhFQUE4RTtBQUU5RSx1RkFBdUY7QUFDdkYsSUFBSSxzQkFBc0IsR0FBRyxFQUFFLENBQUE7QUFFL0IsOEJBQThCO0FBQzlCLE1BQU0sV0FBVyxHQUFHO0lBQ2xCOzs7OztPQUtHO0lBQ0gsSUFBSSxDQUFDLElBQUksRUFBRSxNQUFNLEVBQUUsSUFBSTtRQUNyQixNQUFNLE9BQU8sR0FBRyxzQkFBc0IsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUE7UUFDbEQsTUFBTSxTQUFTLEdBQUcsT0FBTyxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsQ0FBQTtRQUV2QyxLQUFLLE1BQU0sUUFBUSxJQUFJLENBQUMsR0FBRyxT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QUFJLEVBQUUsS0FBSyxFQUFFLFdBQVcsRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtnQkFDakUsQ0FBQyxDQUFDLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxDQUFBO2dCQUN6QixDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFBO2dCQUNoQixDQUFDLENBQUMsVUFBVSxFQUFFLENBQUE7WUFDaEIsQ0FBQyxDQUFDLENBQUE7UUFDSixDQUFDO1FBRUQsS0FBSyxDQUFDLElBQUksQ0FBQyxLQUFLO1lBQ2QsTUFBTSxLQUFLLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQyxDQUFBO1lBQy9CLE1BQU0sS0FBSyxDQUFDLFNBQVMsQ0FBQyx1QkFBdUIsQ0FBQyxDQUFBO1lBQzlDLE1BQU0sS0FBSyxDQUFDLFNBQVMsQ0FBQyxlQUFlLENBQUMsQ0FBQTtRQUN4QyxDQUFDO0tBQ0YsQ0FBQTtBQUNILENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBUywrQkFBK0IsQ0FBQyxjQUFjO0lBQ3JELElBQUksY0FBYyxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQ2pDLE9BQU8sR0FBRyxjQUFjLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUE7SUFDaEQsQ0FBQztJQUVELE9BQU8sR0FBRyxjQUFjLFNBQVMsQ0FBQTtBQUNuQyxDQUFDO0FBRUQsT0FBTyxFQUNMLFdBQVcsRUFDWCx5QkFBeUIsRUFDekIseUJBQXlCLEVBQ3pCLFdBQVcsRUFDWCxpQkFBaUIsRUFDakIsa0JBQWtCLEVBQ2xCLGlCQUFpQixFQUNqQixnQ0FBZ0MsRUFDaEMsK0JBQStCLEVBQy9CLG1DQUFtQyxFQUNuQyxrQkFBa0IsRUFDbEIscUJBQXFCLEVBQ3JCLGdCQUFnQixFQUNoQixZQUFZLEVBQ2IsQ0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgVVVJRCBmcm9tIFwicHVyZS11dWlkXCJcbmltcG9ydCBIYXNNYW55UmVsYXRpb25zaGlwIGZyb20gXCIuL3JlbGF0aW9uc2hpcHMvaGFzLW1hbnkuanNcIlxuXG4vKipcbiAqIEdsb2JhbCBhdWRpdCBldmVudCBidXMgbWF0Y2hpbmcgQWN0aXZlUmVjb3JkQXVkaXRhYmxlOjpFdmVudHMuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBBdWRpdEV2ZW50c1R5cGVcbiAqIEBwcm9wZXJ0eSB7KHR5cGU6IHN0cmluZywgYWN0aW9uOiBzdHJpbmcsIGFyZ3M6IEF1ZGl0RXZlbnRQYXlsb2FkKSA9PiB2b2lkfSBjYWxsIC0gRmlyZSBhbGwgY2FsbGJhY2tzIGZvciBhIG1vZGVsIHR5cGUgKyBhY3Rpb24uXG4gKiBAcHJvcGVydHkgeyh0eXBlOiBzdHJpbmcsIGFjdGlvbjogc3RyaW5nLCBjYWxsYmFjazogKGFyZ3M6IEF1ZGl0RXZlbnRQYXlsb2FkKSA9PiB2b2lkKSA9PiAoKSA9PiB2b2lkfSBjb25uZWN0IC0gUmVnaXN0ZXIgYSBjYWxsYmFjayBmb3IgYSBtb2RlbCB0eXBlICsgYWN0aW9uLiBSZXR1cm5zIGFuIHVuc3Vic2NyaWJlIGZ1bmN0aW9uLlxuICogQHByb3BlcnR5IHsoKSA9PiB2b2lkfSByZXNldCAtIENsZWFyIGFsbCByZWdpc3RlcmVkIGNhbGxiYWNrcy5cbiAqL1xuLyoqXG4gKiBBdWRpdENoYW5nZXMgdHlwZS5cbiAqIEB0eXBlZGVmIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IEF1ZGl0Q2hhbmdlc1xuICovXG5cbi8qKlxuICogQXVkaXRFdmVudFBheWxvYWQgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEF1ZGl0RXZlbnRQYXlsb2FkXG4gKiBAcHJvcGVydHkge3N0cmluZ30gYWN0aW9uIC0gQXVkaXQgYWN0aW9uIG5hbWUuXG4gKiBAcHJvcGVydHkge251bWJlciB8IHN0cmluZ30gYXVkaXRJZCAtIENyZWF0ZWQgYXVkaXQgcm93IGlkLlxuICogQHByb3BlcnR5IHtBdWRpdENoYW5nZXMgfCBudWxsfSBhdWRpdGVkQ2hhbmdlcyAtIENoYW5nZXMgY2FwdHVyZWQgZm9yIHRoZSBhdWRpdC5cbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbH0gcGFyYW1zIC0gT3B0aW9uYWwgY2FsbGVyLXN1cHBsaWVkIGF1ZGl0IHBhcmFtcy5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSByZWNvcmQgLSBBdWRpdGVkIHJlY29yZC5cbiAqL1xuXG4vKipcbiAqIEF1ZGl0Q2FsbGJhY2sgdHlwZS5cbiAqIEB0eXBlZGVmIHsocGF5bG9hZDogQXVkaXRFdmVudFBheWxvYWQpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+fSBBdWRpdENhbGxiYWNrXG4gKi9cblxuLyoqXG4gKiBDcmVhdGVBdWRpdEFyZ3MgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IENyZWF0ZUF1ZGl0QXJnc1xuICogQHByb3BlcnR5IHtzdHJpbmd9IGFjdGlvbiAtIEF1ZGl0IGFjdGlvbiBuYW1lLlxuICogQHByb3BlcnR5IHtBdWRpdENoYW5nZXMgfCBudWxsfSBbYXVkaXRlZENoYW5nZXNdIC0gRXhwbGljaXQgY2hhbmdlcyB0byBwZXJzaXN0LlxuICogQHByb3BlcnR5IHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsfSBbcGFyYW1zXSAtIE9wdGlvbmFsIG1ldGFkYXRhIHRvIHN0b3JlIHdpdGggdGhlIGF1ZGl0LlxuICovXG5cbi8qKlxuICogQXVkaXRlZE1vZGVsQ2xhc3MgdHlwZS5cbiAqIEB0eXBlZGVmIHt0eXBlb2YgaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0ICYge1xuICogICBfYXVkaXRDYWxsYmFja3M/OiBSZWNvcmQ8c3RyaW5nLCBBdWRpdENhbGxiYWNrW10+LFxuICogICBfYXVkaXRMaWZlY3ljbGVDYWxsYmFja3NSZWdpc3RlcmVkPzogYm9vbGVhbixcbiAqICAgX2F1ZGl0VGFibGVSZXNvbHZlZD86IGJvb2xlYW4sXG4gKiAgIF9hdWRpdFRhYmxlRGF0YT86IEF1ZGl0VGFibGVEYXRhXG4gKiB9fSBBdWRpdGVkTW9kZWxDbGFzc1xuICovXG5cbi8qKlxuICogQXVkaXRUYWJsZURhdGEgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEF1ZGl0VGFibGVEYXRhXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IGRlZGljYXRlZCAtIFdoZXRoZXIgYSBkZWRpY2F0ZWQgYXVkaXQgdGFibGUgZXhpc3RzLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHRhYmxlTmFtZSAtIE5hbWUgb2YgdGhlIGF1ZGl0IHRhYmxlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGZvcmVpZ25LZXkgLSBDb2x1bW4gbmFtZSB0aGF0IHJlZmVyZW5jZXMgdGhlIGF1ZGl0ZWQgbW9kZWwuXG4gKiBAcHJvcGVydHkge3R5cGVvZiBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IGF1ZGl0Q2xhc3MgLSBUaGUgYXVkaXQgbW9kZWwgY2xhc3MgdG8gdXNlLlxuICovXG5cbi8qKiBAdHlwZSB7V2Vha01hcDxpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQsIE1hcDxzdHJpbmcsIGJvb2xlYW4+Pn0gKi9cbmNvbnN0IGRlZGljYXRlZFRhYmxlQ2FjaGVCeUNvbmZpZ3VyYXRpb24gPSBuZXcgV2Vha01hcCgpXG5cbi8qKiBAdHlwZSB7V2Vha01hcDxBdWRpdGVkTW9kZWxDbGFzcywgTWFwPHN0cmluZywgQXVkaXRUYWJsZURhdGE+Pn0gKi9cbmNvbnN0IGF1ZGl0VGFibGVEYXRhQnlNb2RlbCA9IG5ldyBXZWFrTWFwKClcblxuLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCB0eXBlb2YgaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gKi9cbmNvbnN0IGF1ZGl0Q2xhc3NDYWNoZSA9IG5ldyBNYXAoKVxuXG5jb25zdCBnZW5lcmF0ZWRBdWRpdFJlbGF0aW9uc2hpcHMgPSBuZXcgV2Vha1NldCgpXG5cbi8qKiBAdHlwZSB7V2Vha01hcDxBdWRpdGVkTW9kZWxDbGFzcywgTWFwPHN0cmluZywgSGFzTWFueVJlbGF0aW9uc2hpcD4+fSAqL1xuY29uc3QgYXVkaXRSZWxhdGlvbnNoaXBzQnlNb2RlbCA9IG5ldyBXZWFrTWFwKClcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBHbG9iYWwgZXZlbnQgYnVzIChsaWtlIEFjdGl2ZVJlY29yZEF1ZGl0YWJsZTo6RXZlbnRzKVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmVjb3JkPHN0cmluZywgQXJyYXk8KGFyZ3M6IEF1ZGl0RXZlbnRQYXlsb2FkKSA9PiB2b2lkPj4+fSAqL1xubGV0IGdsb2JhbEV2ZW50Q29ubmVjdGlvbnMgPSB7fVxuXG4vKiogQHR5cGUge0F1ZGl0RXZlbnRzVHlwZX0gKi9cbmNvbnN0IEF1ZGl0RXZlbnRzID0ge1xuICAvKipcbiAgICogRmlyZSBhbGwgcmVnaXN0ZXJlZCBjYWxsYmFja3MgZm9yIGEgbW9kZWwgdHlwZSBhbmQgYWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdHlwZSAtIEF1ZGl0ZWQgbW9kZWwgdHlwZSB3aG9zZSBsaXN0ZW5lcnMgc2hvdWxkIGZpcmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhY3Rpb24gLSBBdWRpdCBhY3Rpb24gd2hvc2UgbGlzdGVuZXJzIHNob3VsZCBmaXJlLlxuICAgKiBAcGFyYW0ge0F1ZGl0RXZlbnRQYXlsb2FkfSBhcmdzIC0gQXVkaXQgZXZlbnQgZGVsaXZlcmVkIHRvIG1hdGNoaW5nIGxpc3RlbmVycy5cbiAgICovXG4gIGNhbGwodHlwZSwgYWN0aW9uLCBhcmdzKSB7XG4gICAgY29uc3QgYWN0aW9ucyA9IGdsb2JhbEV2ZW50Q29ubmVjdGlvbnNbdHlwZV0gfHwge31cbiAgICBjb25zdCBjYWxsYmFja3MgPSBhY3Rpb25zW2FjdGlvbl0gfHwgW11cblxuICAgIGZvciAoY29uc3QgY2FsbGJhY2sgb2YgWy4uLmNhbGxiYWNrc10pIHtcbiAgICAgIGNhbGxiYWNrKGFyZ3MpXG4gICAgfVxuICB9LFxuXG4gIC8qKlxuICAgKiBSZWdpc3RlciBhIGNhbGxiYWNrIGZvciBhIG1vZGVsIHR5cGUgYW5kIGFjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHR5cGUgLSBBdWRpdGVkIG1vZGVsIHR5cGUgdG8gb2JzZXJ2ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFjdGlvbiAtIEF1ZGl0IGFjdGlvbiB0byBvYnNlcnZlLlxuICAgKiBAcGFyYW0geyhhcmdzOiBBdWRpdEV2ZW50UGF5bG9hZCkgPT4gdm9pZH0gY2FsbGJhY2sgLSBMaXN0ZW5lciBpbnZva2VkIGZvciBtYXRjaGluZyBhdWRpdCBldmVudHMuXG4gICAqIEByZXR1cm5zIHsoKSA9PiB2b2lkfSAtIENhbGxiYWNrIHRoYXQgcmVtb3ZlcyB0aGUgcmVnaXN0cmF0aW9uLlxuICAgKi9cbiAgY29ubmVjdCh0eXBlLCBhY3Rpb24sIGNhbGxiYWNrKSB7XG4gICAgaWYgKCFnbG9iYWxFdmVudENvbm5lY3Rpb25zW3R5cGVdKSB7XG4gICAgICBnbG9iYWxFdmVudENvbm5lY3Rpb25zW3R5cGVdID0ge31cbiAgICB9XG5cbiAgICBpZiAoIWdsb2JhbEV2ZW50Q29ubmVjdGlvbnNbdHlwZV1bYWN0aW9uXSkge1xuICAgICAgZ2xvYmFsRXZlbnRDb25uZWN0aW9uc1t0eXBlXVthY3Rpb25dID0gW11cbiAgICB9XG5cbiAgICBnbG9iYWxFdmVudENvbm5lY3Rpb25zW3R5cGVdW2FjdGlvbl0ucHVzaChjYWxsYmFjaylcblxuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICBjb25zdCBsaXN0ID0gZ2xvYmFsRXZlbnRDb25uZWN0aW9uc1t0eXBlXT8uW2FjdGlvbl1cblxuICAgICAgaWYgKGxpc3QpIHtcbiAgICAgICAgY29uc3QgaW5kZXggPSBsaXN0LmluZGV4T2YoY2FsbGJhY2spXG5cbiAgICAgICAgaWYgKGluZGV4ID49IDApIHtcbiAgICAgICAgICBsaXN0LnNwbGljZShpbmRleCwgMSlcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfSxcblxuICAvKiogQ2xlYXIgYWxsIHJlZ2lzdGVyZWQgY2FsbGJhY2tzLiAqL1xuICByZXNldCgpIHtcbiAgICBnbG9iYWxFdmVudENvbm5lY3Rpb25zID0ge31cbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRhYmxlIGRldGVjdGlvblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogUmV0dXJucyB0aGUgZGVkaWNhdGVkIGF1ZGl0IHRhYmxlIG5hbWUgZm9yIGEgbW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge0F1ZGl0ZWRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gQXVkaXRlZCBtb2RlbCBjbGFzcy5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IGUuZy4gXCJwcm9qZWN0X2F1ZGl0c1wiIGZvciBhIFwicHJvamVjdHNcIiB0YWJsZS5cbiAqL1xuZnVuY3Rpb24gZGVkaWNhdGVkQXVkaXRUYWJsZU5hbWUobW9kZWxDbGFzcykge1xuICBjb25zdCB0YWJsZSA9IG1vZGVsQ2xhc3MudGFibGVOYW1lKClcblxuICBpZiAodGFibGUuZW5kc1dpdGgoXCJzXCIpKSB7XG4gICAgcmV0dXJuIGAke3RhYmxlLnNsaWNlKDAsIC0xKX1fYXVkaXRzYFxuICB9XG5cbiAgcmV0dXJuIGAke3RhYmxlfV9hdWRpdHNgXG59XG5cbi8qKlxuICogUmVzb2x2ZXMgYXVkaXQgdGFibGUgZGF0YSBmb3IgYSBtb2RlbCBjbGFzcy4gQ2FjaGVkIHBlciBtb2RlbC5cbiAqIENhbGxlZCBsYXppbHkgb24gZmlyc3QgY3JlYXRlQXVkaXQgLyB3aXRob3V0QXVkaXQgLyByZWxhdGlvbnNoaXAgdXNhZ2UuXG4gKiBAcGFyYW0ge0F1ZGl0ZWRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gQXVkaXRlZCBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IFtjb25uZWN0aW9uXSAtIEV4cGxpY2l0IHJlY29yZC1vd25lZCBjb25uZWN0aW9uLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9vcGVyYXRpb24uanNcIikuZGVmYXVsdH0gW29wZXJhdGlvbl0gLSBFeHBsaWNpdCByZWNvcmQgb3BlcmF0aW9uLlxuICogQHJldHVybnMge1Byb21pc2U8QXVkaXRUYWJsZURhdGE+fSBSZXNvbHZlZCBhdWRpdCB0YWJsZSBtZXRhZGF0YS5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZUF1ZGl0VGFibGVEYXRhKG1vZGVsQ2xhc3MsIGNvbm5lY3Rpb24sIG9wZXJhdGlvbikge1xuICBjb25zdCByZXNvbHZlZENvbm5lY3Rpb24gPSBjb25uZWN0aW9uIHx8IG1vZGVsQ2xhc3MuY29ubmVjdGlvbigpXG4gIGNvbnN0IGRhdGFiYXNlSWRlbnRpdHkgPSBhdWRpdERhdGFiYXNlSWRlbnRpdHkobW9kZWxDbGFzcywgcmVzb2x2ZWRDb25uZWN0aW9uLCBvcGVyYXRpb24pXG4gIGxldCB0YWJsZURhdGFCeUlkZW50aXR5ID0gYXVkaXRUYWJsZURhdGFCeU1vZGVsLmdldChtb2RlbENsYXNzKVxuXG4gIGlmICghdGFibGVEYXRhQnlJZGVudGl0eSkge1xuICAgIHRhYmxlRGF0YUJ5SWRlbnRpdHkgPSBuZXcgTWFwKClcbiAgICBhdWRpdFRhYmxlRGF0YUJ5TW9kZWwuc2V0KG1vZGVsQ2xhc3MsIHRhYmxlRGF0YUJ5SWRlbnRpdHkpXG4gIH1cblxuICBjb25zdCBjYWNoZWRUYWJsZURhdGEgPSB0YWJsZURhdGFCeUlkZW50aXR5LmdldChkYXRhYmFzZUlkZW50aXR5KVxuXG4gIGlmIChjYWNoZWRUYWJsZURhdGEpIHtcbiAgICByZWdpc3RlckF1ZGl0UmVsYXRpb25zaGlwKG1vZGVsQ2xhc3MsIGNhY2hlZFRhYmxlRGF0YSwgZGF0YWJhc2VJZGVudGl0eSlcbiAgICByZXR1cm4gY2FjaGVkVGFibGVEYXRhXG4gIH1cblxuICBjb25zdCB0YWJsZURhdGEgPSBhd2FpdCBidWlsZEF1ZGl0VGFibGVEYXRhKG1vZGVsQ2xhc3MsIHJlc29sdmVkQ29ubmVjdGlvbiwgZGF0YWJhc2VJZGVudGl0eSlcbiAgY29uc3QgY29uZmlndXJhdGlvbiA9IG1vZGVsQ2xhc3MuX2dldENvbmZpZ3VyYXRpb24oKVxuXG4gIHRhYmxlRGF0YS5hdWRpdENsYXNzLnJlZ2lzdGVyUmVjb3JkQ2xhc3Moe2NvbmZpZ3VyYXRpb259KVxuICBhd2FpdCB0YWJsZURhdGEuYXVkaXRDbGFzcy5pbml0aWFsaXplUmVjb3JkKHtjb25maWd1cmF0aW9uLCBjb25uZWN0aW9uOiByZXNvbHZlZENvbm5lY3Rpb259KVxuXG4gIG1vZGVsQ2xhc3MuX2F1ZGl0VGFibGVEYXRhID0gdGFibGVEYXRhXG4gIG1vZGVsQ2xhc3MuX2F1ZGl0VGFibGVSZXNvbHZlZCA9IHRydWVcbiAgdGFibGVEYXRhQnlJZGVudGl0eS5zZXQoZGF0YWJhc2VJZGVudGl0eSwgdGFibGVEYXRhKVxuXG4gIHJlZ2lzdGVyQXVkaXRSZWxhdGlvbnNoaXAobW9kZWxDbGFzcywgdGFibGVEYXRhLCBkYXRhYmFzZUlkZW50aXR5KVxuXG4gIHJldHVybiB0YWJsZURhdGFcbn1cblxuLyoqXG4gKiBCdWlsZHMgYXVkaXQgdGFibGUgbWV0YWRhdGEgZm9yIGEgbW9kZWwgY2xhc3MuIFByZWZlcnMgdGhlIGNvbnN1bWVyJ3NcbiAqIHJlZ2lzdGVyZWQgQXVkaXQgbW9kZWwgZm9yIHNoYXJlZCB0YWJsZXM7IGZhbGxzIGJhY2sgdG8gYSBmcmFtZXdvcmstb3duZWRcbiAqIGR5bmFtaWMgY2xhc3MuXG4gKiBAcGFyYW0ge0F1ZGl0ZWRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gQXVkaXRlZCBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBFeHBsaWNpdCByZWNvcmQtb3duZWQgY29ubmVjdGlvbi5cbiAqIEBwYXJhbSB7c3RyaW5nfSBkYXRhYmFzZUlkZW50aXR5IC0gQ2FwdHVyZWQgcGh5c2ljYWwgZGF0YWJhc2UgaWRlbnRpdHkuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxBdWRpdFRhYmxlRGF0YT59IEF1ZGl0IHRhYmxlIG1ldGFkYXRhLlxuICovXG5hc3luYyBmdW5jdGlvbiBidWlsZEF1ZGl0VGFibGVEYXRhKG1vZGVsQ2xhc3MsIGNvbm5lY3Rpb24sIGRhdGFiYXNlSWRlbnRpdHkpIHtcbiAgY29uc3QgZGVkaWNhdGVkVGFibGUgPSBkZWRpY2F0ZWRBdWRpdFRhYmxlTmFtZShtb2RlbENsYXNzKVxuICBjb25zdCBkZWRpY2F0ZWRFeGlzdHMgPSBhd2FpdCBkZWRpY2F0ZWRUYWJsZUV4aXN0c0ZvckNvbm5lY3Rpb24obW9kZWxDbGFzcywgZGVkaWNhdGVkVGFibGUsIGNvbm5lY3Rpb24sIGRhdGFiYXNlSWRlbnRpdHkpXG5cbiAgaWYgKGRlZGljYXRlZEV4aXN0cykge1xuICAgIGNvbnN0IGF1ZGl0Q2xhc3MgPSBkZWRpY2F0ZWRBdWRpdENsYXNzKG1vZGVsQ2xhc3MsIGRlZGljYXRlZFRhYmxlKVxuICAgIGNvbnN0IG1vZGVsS2V5ID0gbW9kZWxQYXJhbUtleShtb2RlbENsYXNzKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGF1ZGl0Q2xhc3MsXG4gICAgICBkZWRpY2F0ZWQ6IHRydWUsXG4gICAgICBmb3JlaWduS2V5OiBgJHttb2RlbEtleX1faWRgLFxuICAgICAgdGFibGVOYW1lOiBkZWRpY2F0ZWRUYWJsZVxuICAgIH1cbiAgfVxuXG4gIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSBtb2RlbENsYXNzLl9nZXRDb25maWd1cmF0aW9uKClcblxuICBjb25zdCBjb25zdW1lckF1ZGl0Q2xhc3MgPSBjb25maWd1cmF0aW9uLmdldE1vZGVsQ2xhc3NlcygpLkF1ZGl0XG5cbiAgaWYgKGNvbnN1bWVyQXVkaXRDbGFzcykge1xuICAgIHJldHVybiB7XG4gICAgICBhdWRpdENsYXNzOiBjb25zdW1lckF1ZGl0Q2xhc3MsXG4gICAgICBkZWRpY2F0ZWQ6IGZhbHNlLFxuICAgICAgZm9yZWlnbktleTogXCJhdWRpdGFibGVfaWRcIixcbiAgICAgIHRhYmxlTmFtZTogXCJhdWRpdHNcIlxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7XG4gICAgYXVkaXRDbGFzczogY2FjaGVkU2hhcmVkQXVkaXRDbGFzcyhtb2RlbENsYXNzKSxcbiAgICBkZWRpY2F0ZWQ6IGZhbHNlLFxuICAgIGZvcmVpZ25LZXk6IFwiYXVkaXRhYmxlX2lkXCIsXG4gICAgdGFibGVOYW1lOiBcImF1ZGl0c1wiXG4gIH1cbn1cblxuLyoqXG4gKiBDaGVja3Mgd2hldGhlciBhIGRlZGljYXRlZCBhdWRpdCB0YWJsZSBleGlzdHMgZm9yIGEgbW9kZWwncyBjb25uZWN0aW9uLlxuICogQHBhcmFtIHtBdWRpdGVkTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIEF1ZGl0ZWQgbW9kZWwgY2xhc3Mgb3duaW5nIHRoZSBDb25maWd1cmF0aW9uLlxuICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIERlZGljYXRlZCBhdWRpdCB0YWJsZSBuYW1lIHRvIGNoZWNrLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gY29ubmVjdGlvbiAtIEV4cGxpY2l0IHJlY29yZC1vd25lZCBjb25uZWN0aW9uLlxuICogQHBhcmFtIHtzdHJpbmd9IGRhdGFiYXNlSWRlbnRpdHkgLSBDYXB0dXJlZCBwaHlzaWNhbCBkYXRhYmFzZSBpZGVudGl0eS5cbiAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSBXaGV0aGVyIHRoZSB0YWJsZSBleGlzdHMuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGRlZGljYXRlZFRhYmxlRXhpc3RzRm9yQ29ubmVjdGlvbihtb2RlbENsYXNzLCB0YWJsZU5hbWUsIGNvbm5lY3Rpb24sIGRhdGFiYXNlSWRlbnRpdHkpIHtcbiAgY29uc3QgY29uZmlndXJhdGlvbiA9IG1vZGVsQ2xhc3MuX2dldENvbmZpZ3VyYXRpb24oKVxuICBjb25zdCBjYWNoZUtleSA9IGAke2RhdGFiYXNlSWRlbnRpdHl9OiR7dGFibGVOYW1lfWBcbiAgbGV0IGRlZGljYXRlZFRhYmxlQ2FjaGUgPSBkZWRpY2F0ZWRUYWJsZUNhY2hlQnlDb25maWd1cmF0aW9uLmdldChjb25maWd1cmF0aW9uKVxuXG4gIGlmICghZGVkaWNhdGVkVGFibGVDYWNoZSkge1xuICAgIGRlZGljYXRlZFRhYmxlQ2FjaGUgPSBuZXcgTWFwKClcbiAgICBkZWRpY2F0ZWRUYWJsZUNhY2hlQnlDb25maWd1cmF0aW9uLnNldChjb25maWd1cmF0aW9uLCBkZWRpY2F0ZWRUYWJsZUNhY2hlKVxuICB9XG5cbiAgY29uc3QgY2FjaGVkID0gZGVkaWNhdGVkVGFibGVDYWNoZS5nZXQoY2FjaGVLZXkpXG5cbiAgaWYgKHR5cGVvZiBjYWNoZWQgPT09IFwiYm9vbGVhblwiKSB7XG4gICAgcmV0dXJuIGNhY2hlZFxuICB9XG5cbiAgY29uc3QgdGFibGUgPSBhd2FpdCBjb25uZWN0aW9uLmdldFRhYmxlQnlOYW1lKHRhYmxlTmFtZSwge3Rocm93RXJyb3I6IGZhbHNlfSlcbiAgY29uc3QgZXhpc3RzID0gQm9vbGVhbih0YWJsZSlcblxuICBkZWRpY2F0ZWRUYWJsZUNhY2hlLnNldChjYWNoZUtleSwgZXhpc3RzKVxuXG4gIHJldHVybiBleGlzdHNcbn1cblxuLyoqXG4gKiBSZXNvbHZlcyBhIGNhY2hlIGlkZW50aXR5IGZyb20gZXhwbGljaXQgb3BlcmF0aW9uIG93bmVyc2hpcCBvciB0aGUgYWN0dWFsXG4gKiBzdGFtcGVkIHBvb2wgY29ubmVjdGlvbi4gQW1iaWVudCB0ZW5hbnQgc3RhdGUgaXMgbmV2ZXIgdXNlZCB3aGVuIGFuXG4gKiBvcGVyYXRpb24gaXMgYXZhaWxhYmxlLlxuICogQHBhcmFtIHtBdWRpdGVkTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIEF1ZGl0ZWQgbW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBjb25uZWN0aW9uIC0gQWN0dWFsIGNvbm5lY3Rpb24uXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL29wZXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBbb3BlcmF0aW9uXSAtIEV4cGxpY2l0IG9wZXJhdGlvbi5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gUGh5c2ljYWwgZGF0YWJhc2UgaWRlbnRpdHkuXG4gKi9cbmZ1bmN0aW9uIGF1ZGl0RGF0YWJhc2VJZGVudGl0eShtb2RlbENsYXNzLCBjb25uZWN0aW9uLCBvcGVyYXRpb24pIHtcbiAgaWYgKG9wZXJhdGlvbikgcmV0dXJuIG9wZXJhdGlvbi5kYXRhYmFzZUlkZW50aXR5KClcblxuICBjb25zdCBkYXRhYmFzZUlkZW50aWZpZXIgPSBtb2RlbENsYXNzLmdldERhdGFiYXNlSWRlbnRpZmllcigpXG4gIGNvbnN0IHBvb2wgPSBtb2RlbENsYXNzLl9nZXRDb25maWd1cmF0aW9uKCkuZ2V0RGF0YWJhc2VQb29sKGRhdGFiYXNlSWRlbnRpZmllcilcblxuICByZXR1cm4gYCR7ZGF0YWJhc2VJZGVudGlmaWVyfToke3Bvb2wuZ2V0Q29ubmVjdGlvbkNvbmZpZ3VyYXRpb25SZXVzZUtleShjb25uZWN0aW9uKX1gXG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRHluYW1pYyBhdWRpdCBjbGFzc2VzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBSZXR1cm5zIGEgZnJhbWV3b3JrLW93bmVkIHNoYXJlZCBBdWRpdCBjbGFzcyBmb3IgdGhlIGBhdWRpdHNgIHRhYmxlLlxuICogVGhpcyBpcyBvbmx5IHVzZWQgd2hlbiBubyBjb25zdW1lci1yZWdpc3RlcmVkIEF1ZGl0IG1vZGVsIGV4aXN0cy5cbiAqIEBwYXJhbSB7QXVkaXRlZE1vZGVsQ2xhc3N9IG1vZGVsQ2xhc3MgLSBBbnkgYXVkaXRlZCBtb2RlbCBjbGFzcyAodXNlZCB0byBsb2NhdGUgRGF0YWJhc2VSZWNvcmQpLlxuICogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IFNoYXJlZCBBdWRpdCBtb2RlbCBjbGFzcy5cbiAqL1xuZnVuY3Rpb24gc2hhcmVkQXVkaXRDbGFzcyhtb2RlbENsYXNzKSB7XG4gIGNvbnN0IGRiUmVjb3JkQ2xhc3MgPSBmaW5kRGF0YWJhc2VSZWNvcmRDbGFzcyhtb2RlbENsYXNzKVxuXG4gIC8qKlxuICAgKiBGcmFtZXdvcmstb3duZWQgQXVkaXQgbW9kZWwgZm9yIHRoZSBzaGFyZWQgYGF1ZGl0c2AgdGFibGUuXG4gICAqL1xuICBjbGFzcyBBdWRpdCBleHRlbmRzIGRiUmVjb3JkQ2xhc3Mge1xuICAgIC8qKlxuICAgICAqIFJldHVybnMgdGhlIGJhY2tpbmcgdGFibGUgbmFtZS5cbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNoYXJlZCBgYXVkaXRzYCB0YWJsZSBuYW1lLlxuICAgICAqL1xuICAgIHN0YXRpYyB0YWJsZU5hbWUoKSB7XG4gICAgICByZXR1cm4gXCJhdWRpdHNcIlxuICAgIH1cbiAgfVxuXG4gIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShBdWRpdCwgXCJtb2RlbE5hbWVcIiwge3ZhbHVlOiBcIkF1ZGl0XCIsIHdyaXRhYmxlOiBmYWxzZX0pXG4gIGFwcGx5QXVkaXRDbGFzc0RhdGFiYXNlUm91dGluZyhtb2RlbENsYXNzLCBBdWRpdClcblxuICByZXR1cm4gLyoqIEB0eXBlIHt0eXBlb2YgaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSAqLyAoQXVkaXQpXG59XG5cbi8qKlxuICogUmV0dXJucyB0aGUgY2FjaGVkIGZyYW1ld29yay1vd25lZCBzaGFyZWQgQXVkaXQgY2xhc3MgZm9yIGEgZGF0YWJhc2UuXG4gKiBAcGFyYW0ge0F1ZGl0ZWRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gQW55IGF1ZGl0ZWQgbW9kZWwgY2xhc3MuXG4gKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gU2hhcmVkIEF1ZGl0IG1vZGVsIGNsYXNzLlxuICovXG5mdW5jdGlvbiBjYWNoZWRTaGFyZWRBdWRpdENsYXNzKG1vZGVsQ2xhc3MpIHtcbiAgY29uc3Qgcm91dGluZ0tleSA9IG1vZGVsQ2xhc3MuaGFzVGVuYW50RGF0YWJhc2VJZGVudGlmaWVyUmVzb2x2ZXIoKVxuICAgID8gYHRlbmFudDoke21vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCl9YFxuICAgIDogYGRhdGFiYXNlOiR7bW9kZWxDbGFzcy5nZXRDb25maWd1cmVkRGF0YWJhc2VJZGVudGlmaWVyKCl9YFxuICBjb25zdCBjYWNoZUtleSA9IGBzaGFyZWQ6JHtyb3V0aW5nS2V5fWBcbiAgbGV0IGF1ZGl0Q2xhc3MgPSBhdWRpdENsYXNzQ2FjaGUuZ2V0KGNhY2hlS2V5KVxuXG4gIGlmICghYXVkaXRDbGFzcykge1xuICAgIGF1ZGl0Q2xhc3MgPSBzaGFyZWRBdWRpdENsYXNzKG1vZGVsQ2xhc3MpXG4gICAgYXVkaXRDbGFzc0NhY2hlLnNldChjYWNoZUtleSwgYXVkaXRDbGFzcylcbiAgfVxuXG4gIHJldHVybiBhdWRpdENsYXNzXG59XG5cbi8qKlxuICogUmV0dXJucyBhIGR5bmFtaWMgcGVyLW1vZGVsIGF1ZGl0IGNsYXNzIGZvciBhIGRlZGljYXRlZCB0YWJsZS5cbiAqIEBwYXJhbSB7QXVkaXRlZE1vZGVsQ2xhc3N9IG1vZGVsQ2xhc3MgLSBBdWRpdGVkIG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIERlZGljYXRlZCBhdWRpdCB0YWJsZSBuYW1lIChlLmcuIFwicHJvamVjdF9hdWRpdHNcIikuXG4gKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gRGVkaWNhdGVkIGF1ZGl0IG1vZGVsIGNsYXNzLlxuICovXG5mdW5jdGlvbiBkZWRpY2F0ZWRBdWRpdENsYXNzKG1vZGVsQ2xhc3MsIHRhYmxlTmFtZSkge1xuICBjb25zdCBkYlJlY29yZENsYXNzID0gZmluZERhdGFiYXNlUmVjb3JkQ2xhc3MobW9kZWxDbGFzcylcbiAgY29uc3QgbW9kZWxOYW1lID0gbW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKVxuICBjb25zdCBtb2RlbEtleSA9IG1vZGVsUGFyYW1LZXkobW9kZWxDbGFzcylcblxuICAvKipcbiAgICogRnJhbWV3b3JrLW93bmVkIHBlci1tb2RlbCBBdWRpdCBjbGFzcy5cbiAgICovXG4gIGNsYXNzIE1vZGVsQXVkaXQgZXh0ZW5kcyBkYlJlY29yZENsYXNzIHtcbiAgICAvKipcbiAgICAgKiBSZXR1cm5zIHRoZSBiYWNraW5nIHRhYmxlIG5hbWUuXG4gICAgICogQHJldHVybnMge3N0cmluZ30gLSBEZWRpY2F0ZWQgYXVkaXQgdGFibGUgc3VwcGxpZWQgZm9yIHRoaXMgbW9kZWwgY2xhc3MuXG4gICAgICovXG4gICAgc3RhdGljIHRhYmxlTmFtZSgpIHtcbiAgICAgIHJldHVybiB0YWJsZU5hbWVcbiAgICB9XG4gIH1cblxuICBPYmplY3QuZGVmaW5lUHJvcGVydHkoTW9kZWxBdWRpdCwgXCJtb2RlbE5hbWVcIiwge3ZhbHVlOiBgJHttb2RlbE5hbWV9QXVkaXRgLCB3cml0YWJsZTogZmFsc2V9KVxuICBhcHBseUF1ZGl0Q2xhc3NEYXRhYmFzZVJvdXRpbmcobW9kZWxDbGFzcywgTW9kZWxBdWRpdClcbiAgTW9kZWxBdWRpdC5iZWxvbmdzVG8obW9kZWxLZXksIHtjbGFzc05hbWU6IG1vZGVsTmFtZX0pXG5cbiAgcmV0dXJuIC8qKiBAdHlwZSB7dHlwZW9mIGltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gKi8gKE1vZGVsQXVkaXQpXG59XG5cbi8qKlxuICogTWFrZXMgZnJhbWV3b3JrLW93bmVkIGF1ZGl0IGNsYXNzZXMgcmVhZCB0aGUgc2FtZSBkYXRhYmFzZSBhcyB0aGUgYXVkaXRlZCBtb2RlbC5cbiAqIEBwYXJhbSB7QXVkaXRlZE1vZGVsQ2xhc3N9IG1vZGVsQ2xhc3MgLSBBdWRpdGVkIHNvdXJjZSBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gYXVkaXRDbGFzcyAtIEdlbmVyYXRlZCBhdWRpdCBjbGFzcy5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBhcHBseUF1ZGl0Q2xhc3NEYXRhYmFzZVJvdXRpbmcobW9kZWxDbGFzcywgYXVkaXRDbGFzcykge1xuICBhdWRpdENsYXNzLnNldERhdGFiYXNlSWRlbnRpZmllcihtb2RlbENsYXNzLmdldENvbmZpZ3VyZWREYXRhYmFzZUlkZW50aWZpZXIoKSlcblxuICBpZiAobW9kZWxDbGFzcy5oYXNUZW5hbnREYXRhYmFzZUlkZW50aWZpZXJSZXNvbHZlcigpKSB7XG4gICAgYXVkaXRDbGFzcy5zd2l0Y2hlc1RlbmFudERhdGFiYXNlKCh7dGVuYW50fSkgPT4gbW9kZWxDbGFzcy5nZXRUZW5hbnREYXRhYmFzZUlkZW50aWZpZXIodGVuYW50KSlcbiAgfVxufVxuXG4vKipcbiAqIFdhbGtzIHRoZSBwcm90b3R5cGUgY2hhaW4gdG8gZmluZCB0aGUgcm9vdCBEYXRhYmFzZVJlY29yZCBjbGFzcy5cbiAqIEBwYXJhbSB7QXVkaXRlZE1vZGVsQ2xhc3N9IG1vZGVsQ2xhc3MgLSBBdWRpdGVkIG1vZGVsIGNsYXNzLlxuICogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IFJvb3QgRGF0YWJhc2VSZWNvcmQgY2xhc3MuXG4gKi9cbmZ1bmN0aW9uIGZpbmREYXRhYmFzZVJlY29yZENsYXNzKG1vZGVsQ2xhc3MpIHtcbiAgbGV0IHJlY29yZENsYXNzID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKG1vZGVsQ2xhc3MpXG5cbiAgd2hpbGUgKHJlY29yZENsYXNzICYmIE9iamVjdC5nZXRQcm90b3R5cGVPZihyZWNvcmRDbGFzcykgIT09IEZ1bmN0aW9uLnByb3RvdHlwZSkge1xuICAgIHJlY29yZENsYXNzID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKHJlY29yZENsYXNzKVxuICB9XG5cbiAgcmV0dXJuIC8qKiBAdHlwZSB7dHlwZW9mIGltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gKi8gKHJlY29yZENsYXNzKVxufVxuXG4vKipcbiAqIFJldHVybnMgdGhlIHBhcmFtZXRlci1rZXkgbmFtZSBmb3IgYSBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7QXVkaXRlZE1vZGVsQ2xhc3N9IG1vZGVsQ2xhc3MgLSBBdWRpdGVkIG1vZGVsIGNsYXNzLlxuICogQHJldHVybnMge3N0cmluZ30gZS5nLiBcInByb2plY3RcIiBmb3IgXCJQcm9qZWN0XCIuXG4gKi9cbmZ1bmN0aW9uIG1vZGVsUGFyYW1LZXkobW9kZWxDbGFzcykge1xuICBjb25zdCBuYW1lID0gbW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKVxuXG4gIHJldHVybiBuYW1lLmNoYXJBdCgwKS50b0xvd2VyQ2FzZSgpICsgbmFtZS5zbGljZSgxKVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFJlZ2lzdHJhdGlvbiAoc3luYyDigJQgY2FsbGJhY2tzIG9ubHk7IHRhYmxlIGRldGVjdGlvbiBkZWZlcnJlZClcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFJlZ2lzdGVycyBsaWZlY3ljbGUgY2FsbGJhY2tzIGZvciBhdXRvbWF0aWMgY3JlYXRlL3VwZGF0ZS9kZXN0cm95IGF1ZGl0aW5nLlxuICogVGFibGUgZGV0ZWN0aW9uIGFuZCByZWxhdGlvbnNoaXAgcmVnaXN0cmF0aW9uIGhhcHBlbiBsYXppbHkgb24gZmlyc3QgdXNhZ2UuXG4gKiBDYWxsZWQgc3luY2hyb25vdXNseSBmcm9tIE1vZGVsLmF1ZGl0ZWQoKSBhdCBtb2R1bGUtbG9hZCB0aW1lLlxuICogQHBhcmFtIHtBdWRpdGVkTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzIHRvIGF1ZGl0LlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIHJlZ2lzdGVyQXVkaXRpbmcobW9kZWxDbGFzcykge1xuICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKG1vZGVsQ2xhc3MsIFwiX2F1ZGl0TGlmZWN5Y2xlQ2FsbGJhY2tzUmVnaXN0ZXJlZFwiKSAmJiBtb2RlbENsYXNzLl9hdWRpdExpZmVjeWNsZUNhbGxiYWNrc1JlZ2lzdGVyZWQpIHtcbiAgICByZXR1cm5cbiAgfVxuXG4gIG1vZGVsQ2xhc3MuX2F1ZGl0TGlmZWN5Y2xlQ2FsbGJhY2tzUmVnaXN0ZXJlZCA9IHRydWVcbiAgcmVnaXN0ZXJBdWRpdFJlbGF0aW9uc2hpcChtb2RlbENsYXNzKVxuICBtb2RlbENsYXNzLmJlZm9yZUNyZWF0ZShcImNhcHR1cmVDcmVhdGVBdWRpdENoYW5nZXNcIilcbiAgbW9kZWxDbGFzcy5hZnRlckNyZWF0ZShcImNyZWF0ZUNyZWF0ZUF1ZGl0XCIpXG4gIG1vZGVsQ2xhc3MuYmVmb3JlVXBkYXRlKFwiY2FwdHVyZVVwZGF0ZUF1ZGl0Q2hhbmdlc1wiKVxuICBtb2RlbENsYXNzLmFmdGVyVXBkYXRlKFwiY3JlYXRlVXBkYXRlQXVkaXRcIilcbiAgbW9kZWxDbGFzcy5hZnRlckRlc3Ryb3koXCJjcmVhdGVEZXN0cm95QXVkaXRcIilcbn1cblxuLyoqXG4gKiBJbml0aWFsaXplcyBhdWRpdCBtZXRhZGF0YSBmb3IgYXVkaXRlZCBtb2RlbCBjbGFzc2VzLlxuICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MgdG8gaW5pdGlhbGl6ZS5cbiAqIEBwYXJhbSB7e3Jlc29sdmVUYWJsZURhdGE/OiBib29sZWFufX0gW2FyZ3NdIC0gSW5pdGlhbGl6YXRpb24gb3B0aW9ucy5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICovXG5hc3luYyBmdW5jdGlvbiBpbml0aWFsaXplQXVkaXRpbmcobW9kZWxDbGFzcywgYXJncyA9IHt9KSB7XG4gIGNvbnN0IHtyZXNvbHZlVGFibGVEYXRhID0gZmFsc2V9ID0gYXJnc1xuICBjb25zdCBhdWRpdGVkTW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7QXVkaXRlZE1vZGVsQ2xhc3N9ICovIChtb2RlbENsYXNzKVxuXG4gIGlmICghYXVkaXRlZE1vZGVsQ2xhc3MuX2F1ZGl0TGlmZWN5Y2xlQ2FsbGJhY2tzUmVnaXN0ZXJlZCkge1xuICAgIHJldHVyblxuICB9XG5cbiAgcmVnaXN0ZXJBdWRpdFJlbGF0aW9uc2hpcChhdWRpdGVkTW9kZWxDbGFzcylcblxuICBpZiAocmVzb2x2ZVRhYmxlRGF0YSAmJiBzaG91bGRSZXNvbHZlQXVkaXRUYWJsZURhdGEoYXVkaXRlZE1vZGVsQ2xhc3MpKSB7XG4gICAgYXdhaXQgcmVzb2x2ZUF1ZGl0VGFibGVEYXRhKGF1ZGl0ZWRNb2RlbENsYXNzKVxuICB9XG59XG5cbi8qKlxuICogUmVzb2x2ZXMgYXVkaXQgbWV0YWRhdGEgYWZ0ZXIgYXBwbGljYXRpb24gYW5kIHBhY2thZ2UgbW9kZWwgY2xhc3NlcyBhcmUgcmVnaXN0ZXJlZC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBjb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiB3aG9zZSBtb2RlbHMgc2hvdWxkIGJlIGZpbmFsaXplZC5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICovXG5hc3luYyBmdW5jdGlvbiBpbml0aWFsaXplQXVkaXRlZE1vZGVsUmVsYXRpb25zaGlwcyhjb25maWd1cmF0aW9uKSB7XG4gIGNvbnN0IG1vZGVsQ2xhc3NlcyA9IE9iamVjdC52YWx1ZXMoY29uZmlndXJhdGlvbi5nZXRNb2RlbENsYXNzZXMoKSlcbiAgY29uc3Qgc2hvdWxkUmVzb2x2ZVRhYmxlRGF0YSA9IG1vZGVsQ2xhc3Nlcy5zb21lKChtb2RlbENsYXNzKSA9PiBzaG91bGRSZXNvbHZlQXVkaXRUYWJsZURhdGEobW9kZWxDbGFzcykpXG5cbiAgaWYgKCFzaG91bGRSZXNvbHZlVGFibGVEYXRhKSB7XG4gICAgZm9yIChjb25zdCBtb2RlbENsYXNzIG9mIG1vZGVsQ2xhc3Nlcykge1xuICAgICAgYXdhaXQgaW5pdGlhbGl6ZUF1ZGl0aW5nKG1vZGVsQ2xhc3MpXG4gICAgfVxuXG4gICAgcmV0dXJuXG4gIH1cblxuICBhd2FpdCBjb25maWd1cmF0aW9uLmVuc3VyZUNvbm5lY3Rpb25zKHtuYW1lOiBcIkluaXRpYWxpemUgYXVkaXRlZCBtb2RlbCByZWxhdGlvbnNoaXBzXCJ9LCBhc3luYyAoKSA9PiB7XG4gICAgZm9yIChjb25zdCBtb2RlbENsYXNzIG9mIG1vZGVsQ2xhc3Nlcykge1xuICAgICAgYXdhaXQgaW5pdGlhbGl6ZUF1ZGl0aW5nKG1vZGVsQ2xhc3MsIHtyZXNvbHZlVGFibGVEYXRhOiB0cnVlfSlcbiAgICB9XG4gIH0pXG59XG5cbi8qKlxuICogQ2hlY2tzIHdoZXRoZXIgYXVkaXQgdGFibGUgbWV0YWRhdGEgc2hvdWxkIGJlIHJlc29sdmVkIGZvciBhIG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MgdG8gaW5zcGVjdC5cbiAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIHRhYmxlIG1ldGFkYXRhIHJlc29sdXRpb24gc2hvdWxkIHJ1biBub3cuXG4gKi9cbmZ1bmN0aW9uIHNob3VsZFJlc29sdmVBdWRpdFRhYmxlRGF0YShtb2RlbENsYXNzKSB7XG4gIGNvbnN0IGF1ZGl0ZWRNb2RlbENsYXNzID0gLyoqIEB0eXBlIHtBdWRpdGVkTW9kZWxDbGFzc30gKi8gKG1vZGVsQ2xhc3MpXG5cbiAgaWYgKCFhdWRpdGVkTW9kZWxDbGFzcy5fYXVkaXRMaWZlY3ljbGVDYWxsYmFja3NSZWdpc3RlcmVkKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICByZXR1cm4gQm9vbGVhbihhdWRpdGVkTW9kZWxDbGFzcy5faW5pdGlhbGl6ZWQpICYmIGNhblJlc29sdmVBdWRpdFRhYmxlRGF0YShhdWRpdGVkTW9kZWxDbGFzcylcbn1cblxuLyoqXG4gKiBSZWdpc3RlcnMgdGhlIGF1ZGl0cyByZWxhdGlvbnNoaXAgd2l0aG91dCBmb3JjaW5nIGF1ZGl0IHRhYmxlIGRldGVjdGlvbi5cbiAqIEBwYXJhbSB7QXVkaXRlZE1vZGVsQ2xhc3N9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcyB0byBhdWRpdC5cbiAqIEBwYXJhbSB7QXVkaXRUYWJsZURhdGF9IFt0YWJsZURhdGFdIC0gUmVzb2x2ZWQgYXVkaXQgdGFibGUgZGF0YSB3aGVuIGF2YWlsYWJsZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBbZGF0YWJhc2VJZGVudGl0eV0gLSBSZXNvbHZlZCBwaHlzaWNhbCBkYXRhYmFzZSBpZGVudGl0eS5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiByZWdpc3RlckF1ZGl0UmVsYXRpb25zaGlwKG1vZGVsQ2xhc3MsIHRhYmxlRGF0YSA9IGRlZmF1bHRBdWRpdFJlbGF0aW9uc2hpcFRhYmxlRGF0YShtb2RlbENsYXNzKSwgZGF0YWJhc2VJZGVudGl0eSkge1xuICBpZiAobW9kZWxDbGFzcy5fcmVsYXRpb25zaGlwRXhpc3RzKFwiYXVkaXRzXCIpKSB7XG4gICAgY29uc3QgcmVsYXRpb25zaGlwID0gbW9kZWxDbGFzcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUoXCJhdWRpdHNcIilcblxuICAgIGlmIChnZW5lcmF0ZWRBdWRpdFJlbGF0aW9uc2hpcHMuaGFzKHJlbGF0aW9uc2hpcCkgJiYgZGF0YWJhc2VJZGVudGl0eSkge1xuICAgICAgYXVkaXRSZWxhdGlvbnNoaXBNYXAobW9kZWxDbGFzcykuc2V0KGRhdGFiYXNlSWRlbnRpdHksIGJ1aWxkQXVkaXRSZWxhdGlvbnNoaXAobW9kZWxDbGFzcywgdGFibGVEYXRhKSlcbiAgICB9XG5cbiAgICByZXR1cm5cbiAgfVxuXG4gIG1vZGVsQ2xhc3MuaGFzTWFueShcImF1ZGl0c1wiLCBhdWRpdFJlbGF0aW9uc2hpcFNjb3BlLCB7XG4gICAgZm9yZWlnbktleTogdGFibGVEYXRhLmZvcmVpZ25LZXksXG4gICAga2xhc3M6IHRhYmxlRGF0YS5hdWRpdENsYXNzLFxuICAgIHBvbHltb3JwaGljOiAhdGFibGVEYXRhLmRlZGljYXRlZFxuICB9KVxuICBjb25zdCByZWxhdGlvbnNoaXAgPSBtb2RlbENsYXNzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShcImF1ZGl0c1wiKVxuXG4gIGdlbmVyYXRlZEF1ZGl0UmVsYXRpb25zaGlwcy5hZGQocmVsYXRpb25zaGlwKVxuICByZWxhdGlvbnNoaXAuc2V0UmVjb3JkUmVzb2x2ZXIoKHJlY29yZCkgPT4ge1xuICAgIGNvbnN0IHJlbGF0aW9uc2hpcHMgPSBhdWRpdFJlbGF0aW9uc2hpcE1hcChtb2RlbENsYXNzKVxuICAgIGNvbnN0IG9wZXJhdGlvbiA9IHJlY29yZC5kYXRhYmFzZU9wZXJhdGlvbigpXG5cbiAgICBpZiAob3BlcmF0aW9uKSByZXR1cm4gcmVsYXRpb25zaGlwcy5nZXQob3BlcmF0aW9uLmRhdGFiYXNlSWRlbnRpdHkoKSkgfHwgcmVsYXRpb25zaGlwXG4gICAgaWYgKHJlbGF0aW9uc2hpcHMuc2l6ZSA9PT0gMSkgcmV0dXJuIFsuLi5yZWxhdGlvbnNoaXBzLnZhbHVlcygpXVswXVxuXG4gICAgY29uc3QgaWRlbnRpdHkgPSBhdWRpdERhdGFiYXNlSWRlbnRpdHkobW9kZWxDbGFzcywgcmVjb3JkLmNvbm5lY3Rpb24oKSlcblxuICAgIHJldHVybiByZWxhdGlvbnNoaXBzLmdldChpZGVudGl0eSkgfHwgcmVsYXRpb25zaGlwXG4gIH0pXG59XG5cbi8qKlxuICogUmV0dXJucyBwaHlzaWNhbCBhdWRpdCByZWxhdGlvbnNoaXAgdmFyaWFudHMgZm9yIGEgbW9kZWwuXG4gKiBAcGFyYW0ge0F1ZGl0ZWRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gQXVkaXRlZCBtb2RlbCBjbGFzcy5cbiAqIEByZXR1cm5zIHtNYXA8c3RyaW5nLCBIYXNNYW55UmVsYXRpb25zaGlwPn0gLSBSZWxhdGlvbnNoaXBzIGtleWVkIGJ5IHBoeXNpY2FsIGRhdGFiYXNlIGlkZW50aXR5LlxuICovXG5mdW5jdGlvbiBhdWRpdFJlbGF0aW9uc2hpcE1hcChtb2RlbENsYXNzKSB7XG4gIGxldCByZWxhdGlvbnNoaXBzID0gYXVkaXRSZWxhdGlvbnNoaXBzQnlNb2RlbC5nZXQobW9kZWxDbGFzcylcblxuICBpZiAoIXJlbGF0aW9uc2hpcHMpIHtcbiAgICByZWxhdGlvbnNoaXBzID0gbmV3IE1hcCgpXG4gICAgYXVkaXRSZWxhdGlvbnNoaXBzQnlNb2RlbC5zZXQobW9kZWxDbGFzcywgcmVsYXRpb25zaGlwcylcbiAgfVxuXG4gIHJldHVybiByZWxhdGlvbnNoaXBzXG59XG5cbi8qKlxuICogQnVpbGRzIGltbXV0YWJsZS1ieS1vd25lcnNoaXAgYXVkaXQgcmVsYXRpb25zaGlwIG1ldGFkYXRhIGZvciBvbmUgcGh5c2ljYWwgZGF0YWJhc2UuXG4gKiBAcGFyYW0ge0F1ZGl0ZWRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gQXVkaXRlZCBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7QXVkaXRUYWJsZURhdGF9IHRhYmxlRGF0YSAtIFJlc29sdmVkIGF1ZGl0IHRhYmxlIGRhdGEuXG4gKiBAcmV0dXJucyB7SGFzTWFueVJlbGF0aW9uc2hpcH0gLSBQaHlzaWNhbCByZWxhdGlvbnNoaXAgZGVmaW5pdGlvbi5cbiAqL1xuZnVuY3Rpb24gYnVpbGRBdWRpdFJlbGF0aW9uc2hpcChtb2RlbENsYXNzLCB0YWJsZURhdGEpIHtcbiAgcmV0dXJuIG5ldyBIYXNNYW55UmVsYXRpb25zaGlwKHtcbiAgICBmb3JlaWduS2V5OiB0YWJsZURhdGEuZm9yZWlnbktleSxcbiAgICBrbGFzczogdGFibGVEYXRhLmF1ZGl0Q2xhc3MsXG4gICAgbW9kZWxDbGFzcyxcbiAgICBwb2x5bW9ycGhpYzogIXRhYmxlRGF0YS5kZWRpY2F0ZWQsXG4gICAgcmVsYXRpb25zaGlwTmFtZTogXCJhdWRpdHNcIixcbiAgICBzY29wZTogYXVkaXRSZWxhdGlvbnNoaXBTY29wZSxcbiAgICB0eXBlOiBcImhhc01hbnlcIlxuICB9KVxufVxuXG4vKipcbiAqIFJldHVybnMgdW5yZXNvbHZlZCBzaGFyZWQtYXVkaXQgZGVmYXVsdHMgZm9yIGVhcmx5IHJlbGF0aW9uc2hpcCByZWdpc3RyYXRpb24uXG4gKiBAcGFyYW0ge0F1ZGl0ZWRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MgdG8gYXVkaXQuXG4gKiBAcmV0dXJucyB7QXVkaXRUYWJsZURhdGF9IFNoYXJlZCBhdWRpdCByZWxhdGlvbnNoaXAgZGVmYXVsdHMuXG4gKi9cbmZ1bmN0aW9uIGRlZmF1bHRBdWRpdFJlbGF0aW9uc2hpcFRhYmxlRGF0YShtb2RlbENsYXNzKSB7XG4gIHJldHVybiB7XG4gICAgYXVkaXRDbGFzczogY2FjaGVkU2hhcmVkQXVkaXRDbGFzcyhtb2RlbENsYXNzKSxcbiAgICBkZWRpY2F0ZWQ6IGZhbHNlLFxuICAgIGZvcmVpZ25LZXk6IFwiYXVkaXRhYmxlX2lkXCIsXG4gICAgdGFibGVOYW1lOiBcImF1ZGl0c1wiXG4gIH1cbn1cblxuLyoqXG4gKiBBcHBsaWVzIGRlZmF1bHQgYXVkaXQgb3JkZXJpbmcgdG8gZ2VuZXJhdGVkIGF1ZGl0IHJlbGF0aW9uc2hpcHMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdD59IHF1ZXJ5IC0gQXVkaXQgcXVlcnkuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gT3JkZXJlZCBhdWRpdCBxdWVyeS5cbiAqL1xuZnVuY3Rpb24gYXVkaXRSZWxhdGlvbnNoaXBTY29wZShxdWVyeSkge1xuICByZXR1cm4gcXVlcnkub3JkZXIoe2NvbHVtbjogXCJjcmVhdGVkX2F0XCIsIGRpcmVjdGlvbjogXCJERVNDXCJ9KVxufVxuXG4vKipcbiAqIENoZWNrcyB3aGV0aGVyIHRoZSBjdXJyZW50IHRlbmFudCBjb250ZXh0IGNhbiByZXNvbHZlIGF1ZGl0IHRhYmxlIGRhdGEuXG4gKiBAcGFyYW0ge0F1ZGl0ZWRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MgdG8gaW5zcGVjdC5cbiAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIGF1ZGl0IHRhYmxlIGRhdGEgY2FuIGJlIHJlc29sdmVkIGluIHRoZSBjdXJyZW50IHNjb3BlLlxuICovXG5mdW5jdGlvbiBjYW5SZXNvbHZlQXVkaXRUYWJsZURhdGEobW9kZWxDbGFzcykge1xuICBpZiAoIW1vZGVsQ2xhc3MuaGFzVGVuYW50RGF0YWJhc2VJZGVudGlmaWVyUmVzb2x2ZXIoKSkge1xuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICBjb25zdCB0ZW5hbnREYXRhYmFzZUlkZW50aWZpZXIgPSBtb2RlbENsYXNzLmdldFRlbmFudERhdGFiYXNlSWRlbnRpZmllcigpXG5cbiAgaWYgKCF0ZW5hbnREYXRhYmFzZUlkZW50aWZpZXIpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIHJldHVybiBtb2RlbENsYXNzLl9nZXRDb25maWd1cmF0aW9uKCkuaXNEYXRhYmFzZUlkZW50aWZpZXJBY3RpdmUodGVuYW50RGF0YWJhc2VJZGVudGlmaWVyKVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIENyZWF0aW5nIGF1ZGl0c1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogQ3JlYXRlcyBhbiBhdWRpdCByb3cgZm9yIGEgcmVjb3JkLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IHJlY29yZCAtIFJlY29yZCB0byBhdWRpdC5cbiAqIEBwYXJhbSB7Q3JlYXRlQXVkaXRBcmdzfSBhcmdzIC0gQXVkaXQgcm93IG9wdGlvbnMgKGFjdGlvbiwgYXVkaXRlZENoYW5nZXMsIHBhcmFtcykuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXIgfCBzdHJpbmc+fSBDcmVhdGVkIGF1ZGl0IHJvdyBpZC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gY3JlYXRlQXVkaXQocmVjb3JkLCBhcmdzKSB7XG4gIGNvbnN0IG1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge0F1ZGl0ZWRNb2RlbENsYXNzfSAqLyAocmVjb3JkLmdldE1vZGVsQ2xhc3MoKSlcbiAgY29uc3Qgb3BlcmF0aW9uID0gcmVjb3JkLmRhdGFiYXNlT3BlcmF0aW9uKClcblxuICBpZiAob3BlcmF0aW9uKSByZXR1cm4gYXdhaXQgY3JlYXRlQXVkaXRXaXRoQ3VycmVudENvbm5lY3Rpb24ocmVjb3JkLCBhcmdzLCBtb2RlbENsYXNzKVxuXG4gIHJldHVybiBhd2FpdCBtb2RlbENsYXNzLl9nZXRDb25maWd1cmF0aW9uKCkuZW5zdXJlQ29ubmVjdGlvbnMoe25hbWU6IGAke21vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCl9IGF1ZGl0YH0sIGFzeW5jICgpID0+IHtcbiAgICByZXR1cm4gYXdhaXQgY3JlYXRlQXVkaXRXaXRoQ3VycmVudENvbm5lY3Rpb24ocmVjb3JkLCBhcmdzLCBtb2RlbENsYXNzKVxuICB9KVxufVxuXG4vKipcbiAqIENyZWF0ZXMgYW4gYXVkaXQgcm93IHVzaW5nIHRoZSBjdXJyZW50IG1vZGVsIGRhdGFiYXNlIGNvbm5lY3Rpb24uXG4gKiBSb3V0ZXMgdG8gc2hhcmVkIHRhYmxlIG9yIGRlZGljYXRlZCB0YWJsZSBiYXNlZCBvbiByZXNvbHZlZCBhdWRpdCB0YWJsZSBkYXRhLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IHJlY29yZCAtIFJlY29yZCB0byBhdWRpdC5cbiAqIEBwYXJhbSB7Q3JlYXRlQXVkaXRBcmdzfSBhcmdzIC0gQXVkaXQgcm93IG9wdGlvbnMgKGFjdGlvbiwgYXVkaXRlZENoYW5nZXMsIHBhcmFtcykuXG4gKiBAcGFyYW0ge0F1ZGl0ZWRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gQXVkaXRlZCBtb2RlbCBjbGFzcy5cbiAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlciB8IHN0cmluZz59IENyZWF0ZWQgYXVkaXQgcm93IGlkLlxuICovXG5hc3luYyBmdW5jdGlvbiBjcmVhdGVBdWRpdFdpdGhDdXJyZW50Q29ubmVjdGlvbihyZWNvcmQsIGFyZ3MsIG1vZGVsQ2xhc3MpIHtcbiAgaWYgKCFyZWNvcmQuaXNQZXJzaXN0ZWQoKSkgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgYXVkaXQgdW5wZXJzaXN0ZWQgJHttb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpfSByZWNvcmRgKVxuXG4gIGNvbnN0IGRiID0gcmVjb3JkLmNvbm5lY3Rpb24oKVxuICBjb25zdCB0YWJsZURhdGEgPSBhd2FpdCByZXNvbHZlQXVkaXRUYWJsZURhdGEobW9kZWxDbGFzcywgZGIsIHJlY29yZC5kYXRhYmFzZU9wZXJhdGlvbigpKVxuICBjb25zdCBhY3Rpb24gPSBub3JtYWxpemVBY3Rpb24oYXJncy5hY3Rpb24pXG4gIGNvbnN0IGF1ZGl0ZWRDaGFuZ2VzID0gYXJncy5hdWRpdGVkQ2hhbmdlcyA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IGFyZ3MuYXVkaXRlZENoYW5nZXNcbiAgY29uc3QgcGFyYW1zID0gYXJncy5wYXJhbXMgPT09IHVuZGVmaW5lZCA/IG51bGwgOiBhcmdzLnBhcmFtc1xuICBjb25zdCBjdXJyZW50RGF0ZSA9IG5ldyBEYXRlKClcblxuICBjb25zdCBhdWRpdEFjdGlvbklkID0gYXdhaXQgZmluZE9yQ3JlYXRlTG9va3VwSWQoe1xuICAgIGNvbHVtbk5hbWU6IFwiYWN0aW9uXCIsXG4gICAgY3VycmVudERhdGUsXG4gICAgZGIsXG4gICAgdGFibGVOYW1lOiBcImF1ZGl0X2FjdGlvbnNcIixcbiAgICB2YWx1ZTogYWN0aW9uXG4gIH0pXG5cbiAgY29uc3QgYXVkaXRJZCA9IG5ldyBVVUlEKDQpLmZvcm1hdCgpXG5cbiAgaWYgKHRhYmxlRGF0YS5kZWRpY2F0ZWQpIHtcbiAgICBjb25zdCBtb2RlbEtleSA9IG1vZGVsUGFyYW1LZXkobW9kZWxDbGFzcylcblxuICAgIGF3YWl0IGRiLnF1ZXJ5KGRiLmluc2VydFNxbCh7XG4gICAgICByZXR1cm5MYXN0SW5zZXJ0ZWRDb2x1bW5OYW1lczogW1wiaWRcIl0sXG4gICAgICB0YWJsZU5hbWU6IHRhYmxlRGF0YS50YWJsZU5hbWUsXG4gICAgICBkYXRhOiB7XG4gICAgICAgIGlkOiBhdWRpdElkLFxuICAgICAgICBbYCR7bW9kZWxLZXl9X2lkYF06IHJlY29yZC5pZCgpLFxuICAgICAgICBhdWRpdF9hY3Rpb25faWQ6IGF1ZGl0QWN0aW9uSWQsXG4gICAgICAgIGF1ZGl0ZWRfY2hhbmdlczogYXVkaXRlZENoYW5nZXMsXG4gICAgICAgIHBhcmFtcyxcbiAgICAgICAgY3JlYXRlZF9hdDogY3VycmVudERhdGUsXG4gICAgICAgIHVwZGF0ZWRfYXQ6IGN1cnJlbnREYXRlXG4gICAgICB9XG4gICAgfSkpXG4gIH0gZWxzZSB7XG4gICAgY29uc3QgYXVkaXRBdWRpdGFibGVUeXBlSWQgPSBhd2FpdCBmaW5kT3JDcmVhdGVMb29rdXBJZCh7XG4gICAgICBjb2x1bW5OYW1lOiBcIm5hbWVcIixcbiAgICAgIGN1cnJlbnREYXRlLFxuICAgICAgZGIsXG4gICAgICB0YWJsZU5hbWU6IFwiYXVkaXRfYXVkaXRhYmxlX3R5cGVzXCIsXG4gICAgICB2YWx1ZTogbW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKVxuICAgIH0pXG5cbiAgICBhd2FpdCBkYi5xdWVyeShkYi5pbnNlcnRTcWwoe1xuICAgICAgcmV0dXJuTGFzdEluc2VydGVkQ29sdW1uTmFtZXM6IFtcImlkXCJdLFxuICAgICAgdGFibGVOYW1lOiBcImF1ZGl0c1wiLFxuICAgICAgZGF0YToge1xuICAgICAgICBpZDogYXVkaXRJZCxcbiAgICAgICAgYXVkaXRfYWN0aW9uX2lkOiBhdWRpdEFjdGlvbklkLFxuICAgICAgICBhdWRpdF9hdWRpdGFibGVfdHlwZV9pZDogYXVkaXRBdWRpdGFibGVUeXBlSWQsXG4gICAgICAgIGF1ZGl0YWJsZV9pZDogcmVjb3JkLmlkKCksXG4gICAgICAgIGF1ZGl0YWJsZV90eXBlOiBtb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpLFxuICAgICAgICBhdWRpdGVkX2NoYW5nZXM6IGF1ZGl0ZWRDaGFuZ2VzLFxuICAgICAgICBwYXJhbXMsXG4gICAgICAgIGNyZWF0ZWRfYXQ6IGN1cnJlbnREYXRlLFxuICAgICAgICB1cGRhdGVkX2F0OiBjdXJyZW50RGF0ZVxuICAgICAgfVxuICAgIH0pKVxuICB9XG5cbiAgYXdhaXQgZW1pdEF1ZGl0RXZlbnQobW9kZWxDbGFzcywgYWN0aW9uLCB7XG4gICAgYWN0aW9uLFxuICAgIGF1ZGl0SWQsXG4gICAgYXVkaXRlZENoYW5nZXMsXG4gICAgcGFyYW1zLFxuICAgIHJlY29yZFxuICB9KVxuXG4gIEF1ZGl0RXZlbnRzLmNhbGwobW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKSwgYWN0aW9uLCB7XG4gICAgYWN0aW9uLFxuICAgIGF1ZGl0SWQsXG4gICAgYXVkaXRlZENoYW5nZXMsXG4gICAgcGFyYW1zLFxuICAgIHJlY29yZFxuICB9KVxuXG4gIHJldHVybiBhdWRpdElkXG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gTGlmZWN5Y2xlIGNhbGxiYWNrc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogQ2FwdHVyZXMgY3JlYXRlIGNoYW5nZXMgYmVmb3JlIHBlcnNpc3RlbmNlIGNsZWFycyB0aGUgY2hhbmdlIHNldC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0ICYge19wZW5kaW5nQ3JlYXRlQXVkaXRDaGFuZ2VzPzogQXVkaXRDaGFuZ2VzfX0gcmVjb3JkIC0gUmVjb3JkIHdob3NlIHBlbmRpbmcgY2hhbmdlcyBzaG91bGQgYmUgY2FwdHVyZWQuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gY2FwdHVyZUNyZWF0ZUF1ZGl0Q2hhbmdlcyhyZWNvcmQpIHtcbiAgcmVjb3JkLl9wZW5kaW5nQ3JlYXRlQXVkaXRDaGFuZ2VzID0gYXVkaXRDaGFuZ2VzRm9yQ3VycmVudENoYW5nZXMocmVjb3JkKVxufVxuXG4vKipcbiAqIFdyaXRlcyB0aGUgY3JlYXRlIGF1ZGl0IHJvdyBmb3IgYSBtb2RlbCBpbnN0YW5jZS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0ICYge19wZW5kaW5nQ3JlYXRlQXVkaXRDaGFuZ2VzPzogQXVkaXRDaGFuZ2VzfX0gcmVjb3JkIC0gUmVjb3JkIHRvIGF1ZGl0LlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGNyZWF0ZUNyZWF0ZUF1ZGl0KHJlY29yZCkge1xuICBhd2FpdCBjcmVhdGVBdWRpdChyZWNvcmQsIHtcbiAgICBhY3Rpb246IFwiY3JlYXRlXCIsXG4gICAgYXVkaXRlZENoYW5nZXM6IHJlY29yZC5fcGVuZGluZ0NyZWF0ZUF1ZGl0Q2hhbmdlcyB8fCBudWxsXG4gIH0pXG5cbiAgcmVjb3JkLl9wZW5kaW5nQ3JlYXRlQXVkaXRDaGFuZ2VzID0gdW5kZWZpbmVkXG59XG5cbi8qKlxuICogQ2FwdHVyZXMgdXBkYXRlIGNoYW5nZXMgYmVmb3JlIHBlcnNpc3RlbmNlIGNsZWFycyB0aGUgY2hhbmdlIHNldC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0ICYge19wZW5kaW5nVXBkYXRlQXVkaXRDaGFuZ2VzPzogQXVkaXRDaGFuZ2VzfX0gcmVjb3JkIC0gUmVjb3JkIHdob3NlIHBlbmRpbmcgY2hhbmdlcyBzaG91bGQgYmUgY2FwdHVyZWQuXG4gKiBAcmV0dXJucyB7dm9pZH1cbiAqL1xuZnVuY3Rpb24gY2FwdHVyZVVwZGF0ZUF1ZGl0Q2hhbmdlcyhyZWNvcmQpIHtcbiAgcmVjb3JkLl9wZW5kaW5nVXBkYXRlQXVkaXRDaGFuZ2VzID0gYXVkaXRDaGFuZ2VzRm9yQ3VycmVudENoYW5nZXMocmVjb3JkKVxufVxuXG4vKipcbiAqIFdyaXRlcyB0aGUgdXBkYXRlIGF1ZGl0IHJvdyBmb3IgYSBtb2RlbCBpbnN0YW5jZS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0ICYge19wZW5kaW5nVXBkYXRlQXVkaXRDaGFuZ2VzPzogQXVkaXRDaGFuZ2VzfX0gcmVjb3JkIC0gUmVjb3JkIHRvIGF1ZGl0LlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGNyZWF0ZVVwZGF0ZUF1ZGl0KHJlY29yZCkge1xuICBjb25zdCBhdWRpdGVkQ2hhbmdlcyA9IHJlY29yZC5fcGVuZGluZ1VwZGF0ZUF1ZGl0Q2hhbmdlcyB8fCBudWxsXG5cbiAgcmVjb3JkLl9wZW5kaW5nVXBkYXRlQXVkaXRDaGFuZ2VzID0gdW5kZWZpbmVkXG5cbiAgaWYgKCFhdWRpdGVkQ2hhbmdlcyB8fCBPYmplY3Qua2V5cyhhdWRpdGVkQ2hhbmdlcykubGVuZ3RoIDw9IDApIHJldHVyblxuXG4gIGF3YWl0IGNyZWF0ZUF1ZGl0KHJlY29yZCwge1xuICAgIGFjdGlvbjogXCJ1cGRhdGVcIixcbiAgICBhdWRpdGVkQ2hhbmdlc1xuICB9KVxufVxuXG4vKipcbiAqIFdyaXRlcyB0aGUgZGVzdHJveSBhdWRpdCByb3cgZm9yIGEgbW9kZWwgaW5zdGFuY2UuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gcmVjb3JkIC0gUmVjb3JkIHRvIGF1ZGl0LlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGNyZWF0ZURlc3Ryb3lBdWRpdChyZWNvcmQpIHtcbiAgYXdhaXQgY3JlYXRlQXVkaXQocmVjb3JkLCB7XG4gICAgYWN0aW9uOiBcImRlc3Ryb3lcIixcbiAgICBhdWRpdGVkQ2hhbmdlczogYXVkaXRDaGFuZ2VzRm9yRGVzdHJveShyZWNvcmQpXG4gIH0pXG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gQ2hhbmdlcyBoZWxwZXJzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBDYXB0dXJlcyB0aGUgbmV3IHZhbHVlcyBmb3IgZmllbGRzIGNoYW5nZWQgb24gYSByZWNvcmQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gcmVjb3JkIC0gUmVjb3JkIHdob3NlIHBlbmRpbmcgY2hhbmdlcyBzaG91bGQgYmUgY2FwdHVyZWQuXG4gKiBAcmV0dXJucyB7QXVkaXRDaGFuZ2VzfSBOZXcgdmFsdWVzIGtleWVkIGJ5IGF0dHJpYnV0ZSBuYW1lLlxuICovXG5mdW5jdGlvbiBhdWRpdENoYW5nZXNGb3JDdXJyZW50Q2hhbmdlcyhyZWNvcmQpIHtcbiAgY29uc3QgY2hhbmdlcyA9IHJlY29yZC5jaGFuZ2VzKClcbiAgLyoqIEB0eXBlIHtBdWRpdENoYW5nZXN9ICovXG4gIGNvbnN0IGF1ZGl0ZWRDaGFuZ2VzID0ge31cbiAgY29uc3QgY29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZSA9IHJlY29yZC5nZXRNb2RlbENsYXNzKCkuZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCgpXG5cbiAgZm9yIChjb25zdCBbYXR0cmlidXRlTmFtZSwgY2hhbmdlXSBvZiBPYmplY3QuZW50cmllcyhjaGFuZ2VzKSkge1xuICAgIGF1ZGl0ZWRDaGFuZ2VzW2NvbHVtbk5hbWVUb0F0dHJpYnV0ZU5hbWVbYXR0cmlidXRlTmFtZV0gfHwgYXR0cmlidXRlTmFtZV0gPSBjaGFuZ2VbMV1cbiAgfVxuXG4gIHJldHVybiBhdWRpdGVkQ2hhbmdlc1xufVxuXG4vKipcbiAqIENhcHR1cmVzIHRoZSBjdXJyZW50IGF0dHJpYnV0ZXMgZm9yIGEgZGVzdHJveSBhdWRpdC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSByZWNvcmQgLSBSZWNvcmQgYmVpbmcgZGVzdHJveWVkLlxuICogQHJldHVybnMge0F1ZGl0Q2hhbmdlc30gQ3VycmVudCBhdHRyaWJ1dGVzIGtleWVkIGJ5IGF0dHJpYnV0ZSBuYW1lLlxuICovXG5mdW5jdGlvbiBhdWRpdENoYW5nZXNGb3JEZXN0cm95KHJlY29yZCkge1xuICByZXR1cm4gey4uLnJlY29yZC5hdHRyaWJ1dGVzKCl9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gd2l0aG91dEF1ZGl0XG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBSZXR1cm5zIHJlY29yZHMgd2l0aG91dCBhbiBhdWRpdCByb3cgZm9yIHRoZSBnaXZlbiBhY3Rpb24uXG4gKiBVc2VzIHNoYXJlZC10YWJsZSBkZWZhdWx0cyB3aGVuIHRhYmxlIGRhdGEgaXMgbm90IHlldCByZXNvbHZlZDtcbiAqIHN3aXRjaGVzIHRvIHRoZSBkZWRpY2F0ZWQgdGFibGUgcGF0aCBvbmNlIHJlc29sdmVkLlxuICogQHRlbXBsYXRlIHtBdWRpdGVkTW9kZWxDbGFzc30gTUNcbiAqIEBwYXJhbSB7TUN9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcyB0byBzY29wZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhY3Rpb24gLSBBdWRpdCBhY3Rpb24gdG8gZXhjbHVkZS5cbiAqIEByZXR1cm5zIHtpbXBvcnQoXCIuLi9xdWVyeS9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0PE1DPn0gUXVlcnkgc2NvcGVkIHRvIHJlY29yZHMgd2l0aG91dCB0aGF0IGF1ZGl0IGFjdGlvbi5cbiAqL1xuZnVuY3Rpb24gd2l0aG91dEF1ZGl0KG1vZGVsQ2xhc3MsIGFjdGlvbikge1xuICBjb25zdCBkYiA9IG1vZGVsQ2xhc3MuY29ubmVjdGlvbigpXG4gIGNvbnN0IGRhdGFiYXNlSWRlbnRpdHkgPSBhdWRpdERhdGFiYXNlSWRlbnRpdHkobW9kZWxDbGFzcywgZGIpXG4gIGNvbnN0IHRhYmxlRGF0YSA9IGF1ZGl0VGFibGVEYXRhQnlNb2RlbC5nZXQobW9kZWxDbGFzcyk/LmdldChkYXRhYmFzZUlkZW50aXR5KVxuICBjb25zdCBtb2RlbFRhYmxlU3FsID0gZGIucXVvdGVUYWJsZShtb2RlbENsYXNzLnRhYmxlTmFtZSgpKVxuICBjb25zdCBhdWRpdEFjdGlvbnNUYWJsZVNxbCA9IGRiLnF1b3RlVGFibGUoXCJhdWRpdF9hY3Rpb25zXCIpXG4gIGNvbnN0IG1vZGVsUHJpbWFyeUtleVNxbCA9IGAke21vZGVsVGFibGVTcWx9LiR7ZGIucXVvdGVDb2x1bW4obW9kZWxDbGFzcy5wcmltYXJ5S2V5KCkpfWBcbiAgY29uc3QgYXVkaXRBY3Rpb25zSWRTcWwgPSBgJHthdWRpdEFjdGlvbnNUYWJsZVNxbH0uJHtkYi5xdW90ZUNvbHVtbihcImlkXCIpfWBcbiAgY29uc3QgYXVkaXRBY3Rpb25zQWN0aW9uU3FsID0gYCR7YXVkaXRBY3Rpb25zVGFibGVTcWx9LiR7ZGIucXVvdGVDb2x1bW4oXCJhY3Rpb25cIil9YFxuXG4gIGlmICh0YWJsZURhdGE/LmRlZGljYXRlZCkge1xuICAgIGNvbnN0IG1vZGVsS2V5ID0gbW9kZWxQYXJhbUtleShtb2RlbENsYXNzKVxuICAgIGNvbnN0IGF1ZGl0c1RhYmxlU3FsID0gZGIucXVvdGVUYWJsZSh0YWJsZURhdGEudGFibGVOYW1lKVxuICAgIGNvbnN0IGF1ZGl0QWN0aW9uSWRTcWwgPSBgJHthdWRpdHNUYWJsZVNxbH0uJHtkYi5xdW90ZUNvbHVtbihcImF1ZGl0X2FjdGlvbl9pZFwiKX1gXG4gICAgY29uc3QgbW9kZWxJZFNxbCA9IGAke2F1ZGl0c1RhYmxlU3FsfS4ke2RiLnF1b3RlQ29sdW1uKGAke21vZGVsS2V5fV9pZGApfWBcblxuICAgIHJldHVybiBtb2RlbENsYXNzXG4gICAgICAuYWxsKClcbiAgICAgIC53aGVyZShgXG4gICAgICAgIE5PVCBFWElTVFMgKFxuICAgICAgICAgIFNFTEVDVCAxXG4gICAgICAgICAgRlJPTSAke2F1ZGl0c1RhYmxlU3FsfVxuICAgICAgICAgIElOTkVSIEpPSU4gJHthdWRpdEFjdGlvbnNUYWJsZVNxbH1cbiAgICAgICAgICAgIE9OICR7YXVkaXRBY3Rpb25zSWRTcWx9ID0gJHthdWRpdEFjdGlvbklkU3FsfVxuICAgICAgICAgIFdIRVJFICR7bW9kZWxJZFNxbH0gPSAke21vZGVsUHJpbWFyeUtleVNxbH1cbiAgICAgICAgICAgIEFORCAke2F1ZGl0QWN0aW9uc0FjdGlvblNxbH0gPSAke2RiLnF1b3RlKG5vcm1hbGl6ZUFjdGlvbihhY3Rpb24pKX1cbiAgICAgICAgKVxuICAgICAgYClcbiAgfVxuXG4gIGNvbnN0IGF1ZGl0c1RhYmxlU3FsID0gZGIucXVvdGVUYWJsZShcImF1ZGl0c1wiKVxuICBjb25zdCBhdWRpdEF1ZGl0YWJsZUlkU3FsID0gYCR7YXVkaXRzVGFibGVTcWx9LiR7ZGIucXVvdGVDb2x1bW4oXCJhdWRpdGFibGVfaWRcIil9YFxuICBjb25zdCBhdWRpdEF1ZGl0YWJsZVR5cGVTcWwgPSBgJHthdWRpdHNUYWJsZVNxbH0uJHtkYi5xdW90ZUNvbHVtbihcImF1ZGl0YWJsZV90eXBlXCIpfWBcbiAgY29uc3QgYXVkaXRBY3Rpb25JZFNxbCA9IGAke2F1ZGl0c1RhYmxlU3FsfS4ke2RiLnF1b3RlQ29sdW1uKFwiYXVkaXRfYWN0aW9uX2lkXCIpfWBcblxuICByZXR1cm4gbW9kZWxDbGFzc1xuICAgIC5hbGwoKVxuICAgIC53aGVyZShgXG4gICAgICBOT1QgRVhJU1RTIChcbiAgICAgICAgU0VMRUNUIDFcbiAgICAgICAgRlJPTSAke2F1ZGl0c1RhYmxlU3FsfVxuICAgICAgICBJTk5FUiBKT0lOICR7YXVkaXRBY3Rpb25zVGFibGVTcWx9XG4gICAgICAgICAgT04gJHthdWRpdEFjdGlvbnNJZFNxbH0gPSAke2F1ZGl0QWN0aW9uSWRTcWx9XG4gICAgICAgIFdIRVJFICR7YXVkaXRBdWRpdGFibGVUeXBlU3FsfSA9ICR7ZGIucXVvdGUobW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKSl9XG4gICAgICAgICAgQU5EICR7YXVkaXRBdWRpdGFibGVJZFNxbH0gPSAke21vZGVsUHJpbWFyeUtleVNxbH1cbiAgICAgICAgICBBTkQgJHthdWRpdEFjdGlvbnNBY3Rpb25TcWx9ID0gJHtkYi5xdW90ZShub3JtYWxpemVBY3Rpb24oYWN0aW9uKSl9XG4gICAgICApXG4gICAgYClcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBFdmVudCBjYWxsYmFja3Ncbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFJlZ2lzdGVycyBhIHBlci1tb2RlbCBjYWxsYmFjayBmaXJlZCBhZnRlciBhbiBhdWRpdCByb3cgaXMgY3JlYXRlZC5cbiAqIEBwYXJhbSB7QXVkaXRlZE1vZGVsQ2xhc3N9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcyB0byBvYnNlcnZlLlxuICogQHBhcmFtIHtzdHJpbmd9IGFjdGlvbiAtIEF1ZGl0IGFjdGlvbiBuYW1lIChlLmcuIFwiY3JlYXRlXCIpLlxuICogQHBhcmFtIHtBdWRpdENhbGxiYWNrfSBjYWxsYmFjayAtIENhbGxiYWNrIGludm9rZWQgYWZ0ZXIgbWF0Y2hpbmcgYXVkaXQgcm93cyBhcmUgY3JlYXRlZC5cbiAqIEByZXR1cm5zIHsoKSA9PiB2b2lkfSBVbnN1YnNjcmliZSBmdW5jdGlvbi5cbiAqL1xuZnVuY3Rpb24gcmVnaXN0ZXJBdWRpdENhbGxiYWNrKG1vZGVsQ2xhc3MsIGFjdGlvbiwgY2FsbGJhY2spIHtcbiAgY29uc3Qgbm9ybWFsaXplZEFjdGlvbiA9IG5vcm1hbGl6ZUFjdGlvbihhY3Rpb24pXG4gIGNvbnN0IGNhbGxiYWNrcyA9IGF1ZGl0Q2FsbGJhY2tzRm9yTW9kZWxDbGFzcyhtb2RlbENsYXNzKVxuXG4gIGlmICghY2FsbGJhY2tzW25vcm1hbGl6ZWRBY3Rpb25dKSB7XG4gICAgY2FsbGJhY2tzW25vcm1hbGl6ZWRBY3Rpb25dID0gW11cbiAgfVxuXG4gIGNhbGxiYWNrc1tub3JtYWxpemVkQWN0aW9uXS5wdXNoKGNhbGxiYWNrKVxuXG4gIHJldHVybiAoKSA9PiB7XG4gICAgY29uc3QgYWN0aW9uQ2FsbGJhY2tzID0gY2FsbGJhY2tzW25vcm1hbGl6ZWRBY3Rpb25dXG4gICAgY29uc3QgaW5kZXggPSBhY3Rpb25DYWxsYmFja3MuaW5kZXhPZihjYWxsYmFjaylcblxuICAgIGlmIChpbmRleCA+PSAwKSB7XG4gICAgICBhY3Rpb25DYWxsYmFja3Muc3BsaWNlKGluZGV4LCAxKVxuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIEVtaXRzIHBlci1tb2RlbCBhdWRpdCBjYWxsYmFja3MgZm9yIGEgbW9kZWwvYWN0aW9uIHBhaXIuXG4gKiBAcGFyYW0ge0F1ZGl0ZWRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge3N0cmluZ30gYWN0aW9uIC0gQXVkaXQgYWN0aW9uLlxuICogQHBhcmFtIHtBdWRpdEV2ZW50UGF5bG9hZH0gcGF5bG9hZCAtIEV2ZW50IHBheWxvYWQuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAqL1xuYXN5bmMgZnVuY3Rpb24gZW1pdEF1ZGl0RXZlbnQobW9kZWxDbGFzcywgYWN0aW9uLCBwYXlsb2FkKSB7XG4gIGNvbnN0IGNhbGxiYWNrcyA9IGF1ZGl0Q2FsbGJhY2tzRm9yTW9kZWxDbGFzcyhtb2RlbENsYXNzKVthY3Rpb25dIHx8IFtdXG5cbiAgZm9yIChjb25zdCBjYWxsYmFjayBvZiBbLi4uY2FsbGJhY2tzXSkge1xuICAgIGF3YWl0IGNhbGxiYWNrKHBheWxvYWQpXG4gIH1cbn1cblxuLyoqXG4gKiBSZXR1cm5zIHRoZSBwZXItbW9kZWwgY2FsbGJhY2sgbWFwLlxuICogQHBhcmFtIHtBdWRpdGVkTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICogQHJldHVybnMge1JlY29yZDxzdHJpbmcsIEF1ZGl0Q2FsbGJhY2tbXT59IENhbGxiYWNrIG1hcCBrZXllZCBieSBhY3Rpb24uXG4gKi9cbmZ1bmN0aW9uIGF1ZGl0Q2FsbGJhY2tzRm9yTW9kZWxDbGFzcyhtb2RlbENsYXNzKSB7XG4gIGlmICghT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKG1vZGVsQ2xhc3MsIFwiX2F1ZGl0Q2FsbGJhY2tzXCIpKSB7XG4gICAgbW9kZWxDbGFzcy5fYXVkaXRDYWxsYmFja3MgPSB7fVxuICB9XG5cbiAgY29uc3QgY2FsbGJhY2tzID0gbW9kZWxDbGFzcy5fYXVkaXRDYWxsYmFja3NcblxuICBpZiAoIWNhbGxiYWNrcykgdGhyb3cgbmV3IEVycm9yKGBBdWRpdCBjYWxsYmFja3Mgd2VyZW4ndCBpbml0aWFsaXplZCBmb3IgJHttb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpfWApXG5cbiAgcmV0dXJuIGNhbGxiYWNrc1xufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIExvb2t1cCBoZWxwZXJzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBGaW5kcyBvciBjcmVhdGVzIGEgbG9va3VwIHJvdyBhbmQgcmV0dXJucyBpdHMgaWQuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY29sdW1uTmFtZSAtIExvb2t1cCB2YWx1ZSBjb2x1bW4gbmFtZS5cbiAqIEBwYXJhbSB7RGF0ZX0gYXJncy5jdXJyZW50RGF0ZSAtIFRpbWVzdGFtcCB0byB3cml0ZSB3aGVuIGluc2VydGluZy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MuZGIgLSBEYXRhYmFzZSBkcml2ZXIuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy50YWJsZU5hbWUgLSBMb29rdXAgdGFibGUgbmFtZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnZhbHVlIC0gTG9va3VwIHZhbHVlLlxuICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyIHwgc3RyaW5nPn0gTG9va3VwIHJvdyBpZC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gZmluZE9yQ3JlYXRlTG9va3VwSWQoe2NvbHVtbk5hbWUsIGN1cnJlbnREYXRlLCBkYiwgdGFibGVOYW1lLCB2YWx1ZX0pIHtcbiAgYXdhaXQgZGIudXBzZXJ0KHtcbiAgICB0YWJsZU5hbWUsXG4gICAgY29uZmxpY3RDb2x1bW5zOiBbY29sdW1uTmFtZV0sXG4gICAgdXBkYXRlQ29sdW1uczogW2NvbHVtbk5hbWVdLFxuICAgIGRhdGE6IHtcbiAgICAgIGlkOiBuZXcgVVVJRCg0KS5mb3JtYXQoKSxcbiAgICAgIFtjb2x1bW5OYW1lXTogdmFsdWUsXG4gICAgICBjcmVhdGVkX2F0OiBjdXJyZW50RGF0ZSxcbiAgICAgIHVwZGF0ZWRfYXQ6IGN1cnJlbnREYXRlXG4gICAgfVxuICB9KVxuXG4gIGNvbnN0IGlkID0gYXdhaXQgZmluZExvb2t1cElkKHtjb2x1bW5OYW1lLCBkYiwgdGFibGVOYW1lLCB2YWx1ZX0pXG5cbiAgaWYgKGlkID09PSBudWxsKSB0aHJvdyBuZXcgRXJyb3IoYENvdWxkbid0IGZpbmQgJHt0YWJsZU5hbWV9LiR7Y29sdW1uTmFtZX0gYWZ0ZXIgdXBzZXJ0YClcblxuICByZXR1cm4gaWRcbn1cblxuLyoqXG4gKiBGaW5kcyBhIGxvb2t1cCBpZCBieSB2YWx1ZS5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jb2x1bW5OYW1lIC0gTG9va3VwIHZhbHVlIGNvbHVtbiBuYW1lLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gYXJncy5kYiAtIERhdGFiYXNlIGRyaXZlci5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnRhYmxlTmFtZSAtIExvb2t1cCB0YWJsZSBuYW1lLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudmFsdWUgLSBMb29rdXAgdmFsdWUuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXIgfCBzdHJpbmcgfCBudWxsPn0gTG9va3VwIHJvdyBpZCBvciBudWxsLlxuICovXG5hc3luYyBmdW5jdGlvbiBmaW5kTG9va3VwSWQoe2NvbHVtbk5hbWUsIGRiLCB0YWJsZU5hbWUsIHZhbHVlfSkge1xuICBjb25zdCByb3dzID0gLyoqIEB0eXBlIHtBcnJheTx7aWQ6IG51bWJlciB8IHN0cmluZ30+fSAqLyAoYXdhaXQgZGIucXVlcnkoYFxuICAgIFNFTEVDVCAke2RiLnF1b3RlQ29sdW1uKFwiaWRcIil9IEFTIGlkXG4gICAgRlJPTSAke2RiLnF1b3RlVGFibGUodGFibGVOYW1lKX1cbiAgICBXSEVSRSAke2RiLnF1b3RlQ29sdW1uKGNvbHVtbk5hbWUpfSA9ICR7ZGIucXVvdGUodmFsdWUpfVxuICBgKSlcblxuICBpZiAocm93c1swXSkgcmV0dXJuIHJvd3NbMF0uaWRcblxuICByZXR1cm4gbnVsbFxufVxuXG4vKipcbiAqIE5vcm1hbGl6ZXMgYW4gYXVkaXQgYWN0aW9uIHN0cmluZy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhY3Rpb24gLSBBY3Rpb24gbmFtZS5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IFRyaW1tZWQsIG5vbi1lbXB0eSBhY3Rpb24gbmFtZS5cbiAqL1xuZnVuY3Rpb24gbm9ybWFsaXplQWN0aW9uKGFjdGlvbikge1xuICBjb25zdCBub3JtYWxpemVkQWN0aW9uID0gYWN0aW9uLnRyaW0oKVxuXG4gIGlmICghbm9ybWFsaXplZEFjdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiQXVkaXQgYWN0aW9uIG11c3QgYmUgcHJlc2VudFwiKVxuXG4gIHJldHVybiBub3JtYWxpemVkQWN0aW9uXG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gTWlncmF0aW9uIGhlbHBlcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIENyZWF0ZXMgdGhlIHNoYXJlZCBhdWRpdCB0YWJsZXMgbWlncmF0aW9uIHVwL2Rvd24gY2FsbGJhY2tzIGZvciB1c2UgaW5zaWRlXG4gKiBhIE1pZ3JhdGlvbiBjbGFzcy4gVGhlIGB0YWJsZWAgcGFyYW1ldGVyIGlzIGEgTWlncmF0aW9uIGluc3RhbmNlLlxuICogQHBhcmFtIHt7aWQ/OiB7dHlwZTogc3RyaW5nfX19IFtvcHRpb25zXSAtIElEIGNvbHVtbiBvcHRpb25zLlxuICogQHJldHVybnMge3tkb3duOiAodGFibGU6IGltcG9ydChcIi4uL21pZ3JhdGlvbi9pbmRleC5qc1wiKS5kZWZhdWx0KSA9PiBQcm9taXNlPHZvaWQ+LCB1cDogKHRhYmxlOiBpbXBvcnQoXCIuLi9taWdyYXRpb24vaW5kZXguanNcIikuZGVmYXVsdCkgPT4gUHJvbWlzZTx2b2lkPn19IC0gVXAvZG93biBjYWxsYmFja3MgZm9yIHRoZSBzaGFyZWQgYXVkaXQgdGFibGVzLlxuICovXG5mdW5jdGlvbiBjcmVhdGVTaGFyZWRBdWRpdFRhYmxlc01pZ3JhdGlvbihvcHRpb25zID0ge30pIHtcbiAgY29uc3Qgb3B0cyA9IC8qKiBAdHlwZSB7e2lkPzoge3R5cGU6IHN0cmluZ319fSAqLyAob3B0aW9ucylcbiAgY29uc3QgaWRPcHRpb25zID0gLyoqIEB0eXBlIHt7dHlwZT86IHN0cmluZ319ICovIChvcHRzLmlkIHx8IHt9KVxuICBjb25zdCB0eXBlID0gaWRPcHRpb25zLnR5cGVcblxuICByZXR1cm4ge1xuICAgIGFzeW5jIHVwKHRhYmxlKSB7XG4gICAgICBhd2FpdCB0YWJsZS5jcmVhdGVUYWJsZShcImF1ZGl0X2FjdGlvbnNcIiwge2lkOiAvKiogQHR5cGUge3t0eXBlPzogc3RyaW5nfX0gKi8gKG9wdHMuaWQgfHwge30pfSwgKC8qKiBAdHlwZSB7e3N0cmluZyhuYW1lOiBzdHJpbmcsIG9wdGlvbnM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogdm9pZCwgdGltZXN0YW1wcygpOiB2b2lkfX0gKi8gdCkgPT4ge1xuICAgICAgICB0LnN0cmluZyhcImFjdGlvblwiLCB7aW5kZXg6IHt1bmlxdWU6IHRydWV9LCBudWxsOiBmYWxzZX0pXG4gICAgICAgIHQudGltZXN0YW1wcygpXG4gICAgICB9KVxuXG4gICAgICBhd2FpdCB0YWJsZS5jcmVhdGVUYWJsZShcImF1ZGl0X2F1ZGl0YWJsZV90eXBlc1wiLCB7aWQ6IC8qKiBAdHlwZSB7e3R5cGU/OiBzdHJpbmd9fSAqLyAob3B0cy5pZCB8fCB7fSl9LCAoLyoqIEB0eXBlIHt7c3RyaW5nKG5hbWU6IHN0cmluZywgb3B0aW9uczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiB2b2lkLCB0aW1lc3RhbXBzKCk6IHZvaWR9fSAqLyB0KSA9PiB7XG4gICAgICAgIHQuc3RyaW5nKFwibmFtZVwiLCB7aW5kZXg6IHt1bmlxdWU6IHRydWV9LCBudWxsOiBmYWxzZX0pXG4gICAgICAgIHQudGltZXN0YW1wcygpXG4gICAgICB9KVxuXG4gICAgICBhd2FpdCB0YWJsZS5jcmVhdGVUYWJsZShcImF1ZGl0c1wiLCB7aWQ6IC8qKiBAdHlwZSB7e3R5cGU/OiBzdHJpbmd9fSAqLyAob3B0cy5pZCB8fCB7fSl9LCAoLyoqIEB0eXBlIHt7anNvbihuYW1lOiBzdHJpbmcpOiB2b2lkLCByZWZlcmVuY2VzKG5hbWU6IHN0cmluZywgb3B0aW9uczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiB2b2lkLCB0aW1lc3RhbXBzKCk6IHZvaWR9fSAqLyB0KSA9PiB7XG4gICAgICAgIHQucmVmZXJlbmNlcyhcImF1ZGl0X2FjdGlvblwiLCB7Zm9yZWlnbktleTogdHJ1ZSwgbnVsbDogZmFsc2UsIHR5cGV9KVxuICAgICAgICB0LnJlZmVyZW5jZXMoXCJhdWRpdF9hdWRpdGFibGVfdHlwZVwiLCB7Zm9yZWlnbktleTogdHJ1ZSwgbnVsbDogZmFsc2UsIHR5cGV9KVxuICAgICAgICB0LnJlZmVyZW5jZXMoXCJhdWRpdGFibGVcIiwge251bGw6IGZhbHNlLCBwb2x5bW9ycGhpYzogdHJ1ZSwgdHlwZX0pXG4gICAgICAgIHQuanNvbihcImF1ZGl0ZWRfY2hhbmdlc1wiKVxuICAgICAgICB0Lmpzb24oXCJwYXJhbXNcIilcbiAgICAgICAgdC50aW1lc3RhbXBzKClcbiAgICAgIH0pXG4gICAgfSxcblxuICAgIGFzeW5jIGRvd24odGFibGUpIHtcbiAgICAgIGF3YWl0IHRhYmxlLmRyb3BUYWJsZShcImF1ZGl0c1wiKVxuICAgICAgYXdhaXQgdGFibGUuZHJvcFRhYmxlKFwiYXVkaXRfYXVkaXRhYmxlX3R5cGVzXCIpXG4gICAgICBhd2FpdCB0YWJsZS5kcm9wVGFibGUoXCJhdWRpdF9hY3Rpb25zXCIpXG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogUmV0dXJucyB0aGUgZGVkaWNhdGVkIGF1ZGl0IHRhYmxlIG5hbWUgZm9yIGEgZ2l2ZW4gbW9kZWwgdGFibGUgbmFtZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBtb2RlbFRhYmxlTmFtZSAtIE1vZGVsIHRhYmxlIG5hbWUgKGUuZy4gXCJwcm9qZWN0c1wiKS5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IERlZGljYXRlZCBhdWRpdCB0YWJsZSBuYW1lIChlLmcuIFwicHJvamVjdF9hdWRpdHNcIikuXG4gKi9cbmZ1bmN0aW9uIGRlZGljYXRlZEF1ZGl0VGFibGVOYW1lRm9yVGFibGUobW9kZWxUYWJsZU5hbWUpIHtcbiAgaWYgKG1vZGVsVGFibGVOYW1lLmVuZHNXaXRoKFwic1wiKSkge1xuICAgIHJldHVybiBgJHttb2RlbFRhYmxlTmFtZS5zbGljZSgwLCAtMSl9X2F1ZGl0c2BcbiAgfVxuXG4gIHJldHVybiBgJHttb2RlbFRhYmxlTmFtZX1fYXVkaXRzYFxufVxuXG5leHBvcnQge1xuICBBdWRpdEV2ZW50cyxcbiAgY2FwdHVyZUNyZWF0ZUF1ZGl0Q2hhbmdlcyxcbiAgY2FwdHVyZVVwZGF0ZUF1ZGl0Q2hhbmdlcyxcbiAgY3JlYXRlQXVkaXQsXG4gIGNyZWF0ZUNyZWF0ZUF1ZGl0LFxuICBjcmVhdGVEZXN0cm95QXVkaXQsXG4gIGNyZWF0ZVVwZGF0ZUF1ZGl0LFxuICBjcmVhdGVTaGFyZWRBdWRpdFRhYmxlc01pZ3JhdGlvbixcbiAgZGVkaWNhdGVkQXVkaXRUYWJsZU5hbWVGb3JUYWJsZSxcbiAgaW5pdGlhbGl6ZUF1ZGl0ZWRNb2RlbFJlbGF0aW9uc2hpcHMsXG4gIGluaXRpYWxpemVBdWRpdGluZyxcbiAgcmVnaXN0ZXJBdWRpdENhbGxiYWNrLFxuICByZWdpc3RlckF1ZGl0aW5nLFxuICB3aXRob3V0QXVkaXRcbn1cbiJdfQ==