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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXVkaXRpbmcuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvcmVjb3JkL2F1ZGl0aW5nLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLElBQUksTUFBTSxXQUFXLENBQUE7QUFDNUIsT0FBTyxtQkFBbUIsTUFBTSw2QkFBNkIsQ0FBQTtBQUM3RCxPQUFPLEVBQUMscUJBQXFCLEVBQUUsMEJBQTBCLEVBQUMsTUFBTSxrQ0FBa0MsQ0FBQTtBQUVsRzs7Ozs7O0dBTUc7QUFDSDs7O0dBR0c7QUFFSDs7Ozs7Ozs7R0FRRztBQUVIOzs7R0FHRztBQUVIOzs7Ozs7R0FNRztBQUVIOzs7Ozs7OztHQVFHO0FBRUg7Ozs7Ozs7R0FPRztBQUVILHNGQUFzRjtBQUN0RixNQUFNLGtDQUFrQyxHQUFHLElBQUksT0FBTyxFQUFFLENBQUE7QUFFeEQsc0VBQXNFO0FBQ3RFLE1BQU0scUJBQXFCLEdBQUcsSUFBSSxPQUFPLEVBQUUsQ0FBQTtBQUUzQywrREFBK0Q7QUFDL0QsTUFBTSxlQUFlLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQTtBQUVqQyxNQUFNLDJCQUEyQixHQUFHLElBQUksT0FBTyxFQUFFLENBQUE7QUFFakQsMkVBQTJFO0FBQzNFLE1BQU0seUJBQXlCLEdBQUcsSUFBSSxPQUFPLEVBQUUsQ0FBQTtBQUUvQyw4RUFBOEU7QUFDOUUsd0RBQXdEO0FBQ3hELDhFQUE4RTtBQUU5RSx1RkFBdUY7QUFDdkYsSUFBSSxzQkFBc0IsR0FBRyxFQUFFLENBQUE7QUFFL0IsOEJBQThCO0FBQzlCLE1BQU0sV0FBVyxHQUFHO0lBQ2xCOzs7OztPQUtHO0lBQ0gsSUFBSSxDQUFDLElBQUksRUFBRSxNQUFNLEVBQUUsSUFBSTtRQUNyQixNQUFNLE9BQU8sR0FBRyxzQkFBc0IsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUE7UUFDbEQsTUFBTSxTQUFTLEdBQUcsT0FBTyxDQUFDLE1BQU0s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Q0FBQyxDQUFBO1lBQy9CLE1BQU0sS0FBSyxDQUFDLFNBQVMsQ0FBQyx1QkFBdUIsQ0FBQyxDQUFBO1lBQzlDLE1BQU0sS0FBSyxDQUFDLFNBQVMsQ0FBQyxlQUFlLENBQUMsQ0FBQTtRQUN4QyxDQUFDO0tBQ0YsQ0FBQTtBQUNILENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBUywrQkFBK0IsQ0FBQyxjQUFjO0lBQ3JELElBQUksY0FBYyxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDO1FBQ2pDLE9BQU8sR0FBRyxjQUFjLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUE7SUFDaEQsQ0FBQztJQUVELE9BQU8sR0FBRyxjQUFjLFNBQVMsQ0FBQTtBQUNuQyxDQUFDO0FBRUQsT0FBTyxFQUNMLFdBQVcsRUFDWCx5QkFBeUIsRUFDekIseUJBQXlCLEVBQ3pCLFdBQVcsRUFDWCxpQkFBaUIsRUFDakIsa0JBQWtCLEVBQ2xCLGlCQUFpQixFQUNqQixnQ0FBZ0MsRUFDaEMsK0JBQStCLEVBQy9CLG1DQUFtQyxFQUNuQyxrQkFBa0IsRUFDbEIscUJBQXFCLEVBQ3JCLGdCQUFnQixFQUNoQixZQUFZLEVBQ2IsQ0FBQSIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgVVVJRCBmcm9tIFwicHVyZS11dWlkXCJcbmltcG9ydCBIYXNNYW55UmVsYXRpb25zaGlwIGZyb20gXCIuL3JlbGF0aW9uc2hpcHMvaGFzLW1hbnkuanNcIlxuaW1wb3J0IHtzY2FsYXJNb2RlbFByaW1hcnlLZXksIHNjYWxhck1vZGVsUHJpbWFyeUtleVZhbHVlfSBmcm9tIFwiLi4vLi4vdXRpbHMvbW9kZWwtcHJpbWFyeS1rZXkuanNcIlxuXG4vKipcbiAqIEdsb2JhbCBhdWRpdCBldmVudCBidXMgbWF0Y2hpbmcgQWN0aXZlUmVjb3JkQXVkaXRhYmxlOjpFdmVudHMuXG4gKiBAdHlwZWRlZiB7b2JqZWN0fSBBdWRpdEV2ZW50c1R5cGVcbiAqIEBwcm9wZXJ0eSB7KHR5cGU6IHN0cmluZywgYWN0aW9uOiBzdHJpbmcsIGFyZ3M6IEF1ZGl0RXZlbnRQYXlsb2FkKSA9PiB2b2lkfSBjYWxsIC0gRmlyZSBhbGwgY2FsbGJhY2tzIGZvciBhIG1vZGVsIHR5cGUgKyBhY3Rpb24uXG4gKiBAcHJvcGVydHkgeyh0eXBlOiBzdHJpbmcsIGFjdGlvbjogc3RyaW5nLCBjYWxsYmFjazogKGFyZ3M6IEF1ZGl0RXZlbnRQYXlsb2FkKSA9PiB2b2lkKSA9PiAoKSA9PiB2b2lkfSBjb25uZWN0IC0gUmVnaXN0ZXIgYSBjYWxsYmFjayBmb3IgYSBtb2RlbCB0eXBlICsgYWN0aW9uLiBSZXR1cm5zIGFuIHVuc3Vic2NyaWJlIGZ1bmN0aW9uLlxuICogQHByb3BlcnR5IHsoKSA9PiB2b2lkfSByZXNldCAtIENsZWFyIGFsbCByZWdpc3RlcmVkIGNhbGxiYWNrcy5cbiAqL1xuLyoqXG4gKiBBdWRpdENoYW5nZXMgdHlwZS5cbiAqIEB0eXBlZGVmIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IEF1ZGl0Q2hhbmdlc1xuICovXG5cbi8qKlxuICogQXVkaXRFdmVudFBheWxvYWQgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEF1ZGl0RXZlbnRQYXlsb2FkXG4gKiBAcHJvcGVydHkge3N0cmluZ30gYWN0aW9uIC0gQXVkaXQgYWN0aW9uIG5hbWUuXG4gKiBAcHJvcGVydHkge251bWJlciB8IHN0cmluZ30gYXVkaXRJZCAtIENyZWF0ZWQgYXVkaXQgcm93IGlkLlxuICogQHByb3BlcnR5IHtBdWRpdENoYW5nZXMgfCBudWxsfSBhdWRpdGVkQ2hhbmdlcyAtIENoYW5nZXMgY2FwdHVyZWQgZm9yIHRoZSBhdWRpdC5cbiAqIEBwcm9wZXJ0eSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgbnVsbH0gcGFyYW1zIC0gT3B0aW9uYWwgY2FsbGVyLXN1cHBsaWVkIGF1ZGl0IHBhcmFtcy5cbiAqIEBwcm9wZXJ0eSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSByZWNvcmQgLSBBdWRpdGVkIHJlY29yZC5cbiAqL1xuXG4vKipcbiAqIEF1ZGl0Q2FsbGJhY2sgdHlwZS5cbiAqIEB0eXBlZGVmIHsocGF5bG9hZDogQXVkaXRFdmVudFBheWxvYWQpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+fSBBdWRpdENhbGxiYWNrXG4gKi9cblxuLyoqXG4gKiBDcmVhdGVBdWRpdEFyZ3MgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IENyZWF0ZUF1ZGl0QXJnc1xuICogQHByb3BlcnR5IHtzdHJpbmd9IGFjdGlvbiAtIEF1ZGl0IGFjdGlvbiBuYW1lLlxuICogQHByb3BlcnR5IHtBdWRpdENoYW5nZXMgfCBudWxsfSBbYXVkaXRlZENoYW5nZXNdIC0gRXhwbGljaXQgY2hhbmdlcyB0byBwZXJzaXN0LlxuICogQHByb3BlcnR5IHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBudWxsfSBbcGFyYW1zXSAtIE9wdGlvbmFsIG1ldGFkYXRhIHRvIHN0b3JlIHdpdGggdGhlIGF1ZGl0LlxuICovXG5cbi8qKlxuICogQXVkaXRlZE1vZGVsQ2xhc3MgdHlwZS5cbiAqIEB0eXBlZGVmIHt0eXBlb2YgaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0ICYge1xuICogICBfYXVkaXRDYWxsYmFja3M/OiBSZWNvcmQ8c3RyaW5nLCBBdWRpdENhbGxiYWNrW10+LFxuICogICBfYXVkaXRMaWZlY3ljbGVDYWxsYmFja3NSZWdpc3RlcmVkPzogYm9vbGVhbixcbiAqICAgX2F1ZGl0VGFibGVSZXNvbHZlZD86IGJvb2xlYW4sXG4gKiAgIF9hdWRpdFRhYmxlRGF0YT86IEF1ZGl0VGFibGVEYXRhXG4gKiB9fSBBdWRpdGVkTW9kZWxDbGFzc1xuICovXG5cbi8qKlxuICogQXVkaXRUYWJsZURhdGEgdHlwZS5cbiAqIEB0eXBlZGVmIHtvYmplY3R9IEF1ZGl0VGFibGVEYXRhXG4gKiBAcHJvcGVydHkge2Jvb2xlYW59IGRlZGljYXRlZCAtIFdoZXRoZXIgYSBkZWRpY2F0ZWQgYXVkaXQgdGFibGUgZXhpc3RzLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IHRhYmxlTmFtZSAtIE5hbWUgb2YgdGhlIGF1ZGl0IHRhYmxlLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGZvcmVpZ25LZXkgLSBDb2x1bW4gbmFtZSB0aGF0IHJlZmVyZW5jZXMgdGhlIGF1ZGl0ZWQgbW9kZWwuXG4gKiBAcHJvcGVydHkge3R5cGVvZiBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IGF1ZGl0Q2xhc3MgLSBUaGUgYXVkaXQgbW9kZWwgY2xhc3MgdG8gdXNlLlxuICovXG5cbi8qKiBAdHlwZSB7V2Vha01hcDxpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQsIE1hcDxzdHJpbmcsIGJvb2xlYW4+Pn0gKi9cbmNvbnN0IGRlZGljYXRlZFRhYmxlQ2FjaGVCeUNvbmZpZ3VyYXRpb24gPSBuZXcgV2Vha01hcCgpXG5cbi8qKiBAdHlwZSB7V2Vha01hcDxBdWRpdGVkTW9kZWxDbGFzcywgTWFwPHN0cmluZywgQXVkaXRUYWJsZURhdGE+Pn0gKi9cbmNvbnN0IGF1ZGl0VGFibGVEYXRhQnlNb2RlbCA9IG5ldyBXZWFrTWFwKClcblxuLyoqIEB0eXBlIHtNYXA8c3RyaW5nLCB0eXBlb2YgaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gKi9cbmNvbnN0IGF1ZGl0Q2xhc3NDYWNoZSA9IG5ldyBNYXAoKVxuXG5jb25zdCBnZW5lcmF0ZWRBdWRpdFJlbGF0aW9uc2hpcHMgPSBuZXcgV2Vha1NldCgpXG5cbi8qKiBAdHlwZSB7V2Vha01hcDxBdWRpdGVkTW9kZWxDbGFzcywgTWFwPHN0cmluZywgSGFzTWFueVJlbGF0aW9uc2hpcD4+fSAqL1xuY29uc3QgYXVkaXRSZWxhdGlvbnNoaXBzQnlNb2RlbCA9IG5ldyBXZWFrTWFwKClcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBHbG9iYWwgZXZlbnQgYnVzIChsaWtlIEFjdGl2ZVJlY29yZEF1ZGl0YWJsZTo6RXZlbnRzKVxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmVjb3JkPHN0cmluZywgQXJyYXk8KGFyZ3M6IEF1ZGl0RXZlbnRQYXlsb2FkKSA9PiB2b2lkPj4+fSAqL1xubGV0IGdsb2JhbEV2ZW50Q29ubmVjdGlvbnMgPSB7fVxuXG4vKiogQHR5cGUge0F1ZGl0RXZlbnRzVHlwZX0gKi9cbmNvbnN0IEF1ZGl0RXZlbnRzID0ge1xuICAvKipcbiAgICogRmlyZSBhbGwgcmVnaXN0ZXJlZCBjYWxsYmFja3MgZm9yIGEgbW9kZWwgdHlwZSBhbmQgYWN0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gdHlwZSAtIEF1ZGl0ZWQgbW9kZWwgdHlwZSB3aG9zZSBsaXN0ZW5lcnMgc2hvdWxkIGZpcmUuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhY3Rpb24gLSBBdWRpdCBhY3Rpb24gd2hvc2UgbGlzdGVuZXJzIHNob3VsZCBmaXJlLlxuICAgKiBAcGFyYW0ge0F1ZGl0RXZlbnRQYXlsb2FkfSBhcmdzIC0gQXVkaXQgZXZlbnQgZGVsaXZlcmVkIHRvIG1hdGNoaW5nIGxpc3RlbmVycy5cbiAgICovXG4gIGNhbGwodHlwZSwgYWN0aW9uLCBhcmdzKSB7XG4gICAgY29uc3QgYWN0aW9ucyA9IGdsb2JhbEV2ZW50Q29ubmVjdGlvbnNbdHlwZV0gfHwge31cbiAgICBjb25zdCBjYWxsYmFja3MgPSBhY3Rpb25zW2FjdGlvbl0gfHwgW11cblxuICAgIGZvciAoY29uc3QgY2FsbGJhY2sgb2YgWy4uLmNhbGxiYWNrc10pIHtcbiAgICAgIGNhbGxiYWNrKGFyZ3MpXG4gICAgfVxuICB9LFxuXG4gIC8qKlxuICAgKiBSZWdpc3RlciBhIGNhbGxiYWNrIGZvciBhIG1vZGVsIHR5cGUgYW5kIGFjdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHR5cGUgLSBBdWRpdGVkIG1vZGVsIHR5cGUgdG8gb2JzZXJ2ZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFjdGlvbiAtIEF1ZGl0IGFjdGlvbiB0byBvYnNlcnZlLlxuICAgKiBAcGFyYW0geyhhcmdzOiBBdWRpdEV2ZW50UGF5bG9hZCkgPT4gdm9pZH0gY2FsbGJhY2sgLSBMaXN0ZW5lciBpbnZva2VkIGZvciBtYXRjaGluZyBhdWRpdCBldmVudHMuXG4gICAqIEByZXR1cm5zIHsoKSA9PiB2b2lkfSAtIENhbGxiYWNrIHRoYXQgcmVtb3ZlcyB0aGUgcmVnaXN0cmF0aW9uLlxuICAgKi9cbiAgY29ubmVjdCh0eXBlLCBhY3Rpb24sIGNhbGxiYWNrKSB7XG4gICAgaWYgKCFnbG9iYWxFdmVudENvbm5lY3Rpb25zW3R5cGVdKSB7XG4gICAgICBnbG9iYWxFdmVudENvbm5lY3Rpb25zW3R5cGVdID0ge31cbiAgICB9XG5cbiAgICBpZiAoIWdsb2JhbEV2ZW50Q29ubmVjdGlvbnNbdHlwZV1bYWN0aW9uXSkge1xuICAgICAgZ2xvYmFsRXZlbnRDb25uZWN0aW9uc1t0eXBlXVthY3Rpb25dID0gW11cbiAgICB9XG5cbiAgICBnbG9iYWxFdmVudENvbm5lY3Rpb25zW3R5cGVdW2FjdGlvbl0ucHVzaChjYWxsYmFjaylcblxuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICBjb25zdCBsaXN0ID0gZ2xvYmFsRXZlbnRDb25uZWN0aW9uc1t0eXBlXT8uW2FjdGlvbl1cblxuICAgICAgaWYgKGxpc3QpIHtcbiAgICAgICAgY29uc3QgaW5kZXggPSBsaXN0LmluZGV4T2YoY2FsbGJhY2spXG5cbiAgICAgICAgaWYgKGluZGV4ID49IDApIHtcbiAgICAgICAgICBsaXN0LnNwbGljZShpbmRleCwgMSlcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfSxcblxuICAvKiogQ2xlYXIgYWxsIHJlZ2lzdGVyZWQgY2FsbGJhY2tzLiAqL1xuICByZXNldCgpIHtcbiAgICBnbG9iYWxFdmVudENvbm5lY3Rpb25zID0ge31cbiAgfVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFRhYmxlIGRldGVjdGlvblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogUmV0dXJucyB0aGUgZGVkaWNhdGVkIGF1ZGl0IHRhYmxlIG5hbWUgZm9yIGEgbW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge0F1ZGl0ZWRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gQXVkaXRlZCBtb2RlbCBjbGFzcy5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IGUuZy4gXCJwcm9qZWN0X2F1ZGl0c1wiIGZvciBhIFwicHJvamVjdHNcIiB0YWJsZS5cbiAqL1xuZnVuY3Rpb24gZGVkaWNhdGVkQXVkaXRUYWJsZU5hbWUobW9kZWxDbGFzcykge1xuICBjb25zdCB0YWJsZSA9IG1vZGVsQ2xhc3MudGFibGVOYW1lKClcblxuICBpZiAodGFibGUuZW5kc1dpdGgoXCJzXCIpKSB7XG4gICAgcmV0dXJuIGAke3RhYmxlLnNsaWNlKDAsIC0xKX1fYXVkaXRzYFxuICB9XG5cbiAgcmV0dXJuIGAke3RhYmxlfV9hdWRpdHNgXG59XG5cbi8qKlxuICogUmVzb2x2ZXMgYXVkaXQgdGFibGUgZGF0YSBmb3IgYSBtb2RlbCBjbGFzcy4gQ2FjaGVkIHBlciBtb2RlbC5cbiAqIENhbGxlZCBsYXppbHkgb24gZmlyc3QgY3JlYXRlQXVkaXQgLyB3aXRob3V0QXVkaXQgLyByZWxhdGlvbnNoaXAgdXNhZ2UuXG4gKiBAcGFyYW0ge0F1ZGl0ZWRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gQXVkaXRlZCBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IFtjb25uZWN0aW9uXSAtIEV4cGxpY2l0IHJlY29yZC1vd25lZCBjb25uZWN0aW9uLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9vcGVyYXRpb24uanNcIikuZGVmYXVsdH0gW29wZXJhdGlvbl0gLSBFeHBsaWNpdCByZWNvcmQgb3BlcmF0aW9uLlxuICogQHJldHVybnMge1Byb21pc2U8QXVkaXRUYWJsZURhdGE+fSBSZXNvbHZlZCBhdWRpdCB0YWJsZSBtZXRhZGF0YS5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZUF1ZGl0VGFibGVEYXRhKG1vZGVsQ2xhc3MsIGNvbm5lY3Rpb24sIG9wZXJhdGlvbikge1xuICBjb25zdCByZXNvbHZlZENvbm5lY3Rpb24gPSBjb25uZWN0aW9uIHx8IG1vZGVsQ2xhc3MuY29ubmVjdGlvbigpXG4gIGNvbnN0IGRhdGFiYXNlSWRlbnRpdHkgPSBhdWRpdERhdGFiYXNlSWRlbnRpdHkobW9kZWxDbGFzcywgcmVzb2x2ZWRDb25uZWN0aW9uLCBvcGVyYXRpb24pXG4gIGxldCB0YWJsZURhdGFCeUlkZW50aXR5ID0gYXVkaXRUYWJsZURhdGFCeU1vZGVsLmdldChtb2RlbENsYXNzKVxuXG4gIGlmICghdGFibGVEYXRhQnlJZGVudGl0eSkge1xuICAgIHRhYmxlRGF0YUJ5SWRlbnRpdHkgPSBuZXcgTWFwKClcbiAgICBhdWRpdFRhYmxlRGF0YUJ5TW9kZWwuc2V0KG1vZGVsQ2xhc3MsIHRhYmxlRGF0YUJ5SWRlbnRpdHkpXG4gIH1cblxuICBjb25zdCBjYWNoZWRUYWJsZURhdGEgPSB0YWJsZURhdGFCeUlkZW50aXR5LmdldChkYXRhYmFzZUlkZW50aXR5KVxuXG4gIGlmIChjYWNoZWRUYWJsZURhdGEpIHtcbiAgICByZWdpc3RlckF1ZGl0UmVsYXRpb25zaGlwKG1vZGVsQ2xhc3MsIGNhY2hlZFRhYmxlRGF0YSwgZGF0YWJhc2VJZGVudGl0eSlcbiAgICByZXR1cm4gY2FjaGVkVGFibGVEYXRhXG4gIH1cblxuICBjb25zdCB0YWJsZURhdGEgPSBhd2FpdCBidWlsZEF1ZGl0VGFibGVEYXRhKG1vZGVsQ2xhc3MsIHJlc29sdmVkQ29ubmVjdGlvbiwgZGF0YWJhc2VJZGVudGl0eSlcbiAgY29uc3QgY29uZmlndXJhdGlvbiA9IG1vZGVsQ2xhc3MuX2dldENvbmZpZ3VyYXRpb24oKVxuXG4gIHRhYmxlRGF0YS5hdWRpdENsYXNzLnJlZ2lzdGVyUmVjb3JkQ2xhc3Moe2NvbmZpZ3VyYXRpb259KVxuICBhd2FpdCB0YWJsZURhdGEuYXVkaXRDbGFzcy5pbml0aWFsaXplUmVjb3JkKHtjb25maWd1cmF0aW9uLCBjb25uZWN0aW9uOiByZXNvbHZlZENvbm5lY3Rpb259KVxuXG4gIG1vZGVsQ2xhc3MuX2F1ZGl0VGFibGVEYXRhID0gdGFibGVEYXRhXG4gIG1vZGVsQ2xhc3MuX2F1ZGl0VGFibGVSZXNvbHZlZCA9IHRydWVcbiAgdGFibGVEYXRhQnlJZGVudGl0eS5zZXQoZGF0YWJhc2VJZGVudGl0eSwgdGFibGVEYXRhKVxuXG4gIHJlZ2lzdGVyQXVkaXRSZWxhdGlvbnNoaXAobW9kZWxDbGFzcywgdGFibGVEYXRhLCBkYXRhYmFzZUlkZW50aXR5KVxuXG4gIHJldHVybiB0YWJsZURhdGFcbn1cblxuLyoqXG4gKiBCdWlsZHMgYXVkaXQgdGFibGUgbWV0YWRhdGEgZm9yIGEgbW9kZWwgY2xhc3MuIFByZWZlcnMgdGhlIGNvbnN1bWVyJ3NcbiAqIHJlZ2lzdGVyZWQgQXVkaXQgbW9kZWwgZm9yIHNoYXJlZCB0YWJsZXM7IGZhbGxzIGJhY2sgdG8gYSBmcmFtZXdvcmstb3duZWRcbiAqIGR5bmFtaWMgY2xhc3MuXG4gKiBAcGFyYW0ge0F1ZGl0ZWRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gQXVkaXRlZCBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGNvbm5lY3Rpb24gLSBFeHBsaWNpdCByZWNvcmQtb3duZWQgY29ubmVjdGlvbi5cbiAqIEBwYXJhbSB7c3RyaW5nfSBkYXRhYmFzZUlkZW50aXR5IC0gQ2FwdHVyZWQgcGh5c2ljYWwgZGF0YWJhc2UgaWRlbnRpdHkuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxBdWRpdFRhYmxlRGF0YT59IEF1ZGl0IHRhYmxlIG1ldGFkYXRhLlxuICovXG5hc3luYyBmdW5jdGlvbiBidWlsZEF1ZGl0VGFibGVEYXRhKG1vZGVsQ2xhc3MsIGNvbm5lY3Rpb24sIGRhdGFiYXNlSWRlbnRpdHkpIHtcbiAgY29uc3QgZGVkaWNhdGVkVGFibGUgPSBkZWRpY2F0ZWRBdWRpdFRhYmxlTmFtZShtb2RlbENsYXNzKVxuICBjb25zdCBkZWRpY2F0ZWRFeGlzdHMgPSBhd2FpdCBkZWRpY2F0ZWRUYWJsZUV4aXN0c0ZvckNvbm5lY3Rpb24obW9kZWxDbGFzcywgZGVkaWNhdGVkVGFibGUsIGNvbm5lY3Rpb24sIGRhdGFiYXNlSWRlbnRpdHkpXG5cbiAgaWYgKGRlZGljYXRlZEV4aXN0cykge1xuICAgIGNvbnN0IGF1ZGl0Q2xhc3MgPSBkZWRpY2F0ZWRBdWRpdENsYXNzKG1vZGVsQ2xhc3MsIGRlZGljYXRlZFRhYmxlKVxuICAgIGNvbnN0IG1vZGVsS2V5ID0gbW9kZWxQYXJhbUtleShtb2RlbENsYXNzKVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGF1ZGl0Q2xhc3MsXG4gICAgICBkZWRpY2F0ZWQ6IHRydWUsXG4gICAgICBmb3JlaWduS2V5OiBgJHttb2RlbEtleX1faWRgLFxuICAgICAgdGFibGVOYW1lOiBkZWRpY2F0ZWRUYWJsZVxuICAgIH1cbiAgfVxuXG4gIGNvbnN0IGNvbmZpZ3VyYXRpb24gPSBtb2RlbENsYXNzLl9nZXRDb25maWd1cmF0aW9uKClcblxuICBjb25zdCBjb25zdW1lckF1ZGl0Q2xhc3MgPSBjb25maWd1cmF0aW9uLmdldE1vZGVsQ2xhc3NlcygpLkF1ZGl0XG5cbiAgaWYgKGNvbnN1bWVyQXVkaXRDbGFzcykge1xuICAgIHJldHVybiB7XG4gICAgICBhdWRpdENsYXNzOiBjb25zdW1lckF1ZGl0Q2xhc3MsXG4gICAgICBkZWRpY2F0ZWQ6IGZhbHNlLFxuICAgICAgZm9yZWlnbktleTogXCJhdWRpdGFibGVfaWRcIixcbiAgICAgIHRhYmxlTmFtZTogXCJhdWRpdHNcIlxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7XG4gICAgYXVkaXRDbGFzczogY2FjaGVkU2hhcmVkQXVkaXRDbGFzcyhtb2RlbENsYXNzKSxcbiAgICBkZWRpY2F0ZWQ6IGZhbHNlLFxuICAgIGZvcmVpZ25LZXk6IFwiYXVkaXRhYmxlX2lkXCIsXG4gICAgdGFibGVOYW1lOiBcImF1ZGl0c1wiXG4gIH1cbn1cblxuLyoqXG4gKiBDaGVja3Mgd2hldGhlciBhIGRlZGljYXRlZCBhdWRpdCB0YWJsZSBleGlzdHMgZm9yIGEgbW9kZWwncyBjb25uZWN0aW9uLlxuICogQHBhcmFtIHtBdWRpdGVkTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIEF1ZGl0ZWQgbW9kZWwgY2xhc3Mgb3duaW5nIHRoZSBDb25maWd1cmF0aW9uLlxuICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIERlZGljYXRlZCBhdWRpdCB0YWJsZSBuYW1lIHRvIGNoZWNrLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9kcml2ZXJzL2Jhc2UuanNcIikuZGVmYXVsdH0gY29ubmVjdGlvbiAtIEV4cGxpY2l0IHJlY29yZC1vd25lZCBjb25uZWN0aW9uLlxuICogQHBhcmFtIHtzdHJpbmd9IGRhdGFiYXNlSWRlbnRpdHkgLSBDYXB0dXJlZCBwaHlzaWNhbCBkYXRhYmFzZSBpZGVudGl0eS5cbiAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSBXaGV0aGVyIHRoZSB0YWJsZSBleGlzdHMuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGRlZGljYXRlZFRhYmxlRXhpc3RzRm9yQ29ubmVjdGlvbihtb2RlbENsYXNzLCB0YWJsZU5hbWUsIGNvbm5lY3Rpb24sIGRhdGFiYXNlSWRlbnRpdHkpIHtcbiAgY29uc3QgY29uZmlndXJhdGlvbiA9IG1vZGVsQ2xhc3MuX2dldENvbmZpZ3VyYXRpb24oKVxuICBjb25zdCBjYWNoZUtleSA9IGAke2RhdGFiYXNlSWRlbnRpdHl9OiR7dGFibGVOYW1lfWBcbiAgbGV0IGRlZGljYXRlZFRhYmxlQ2FjaGUgPSBkZWRpY2F0ZWRUYWJsZUNhY2hlQnlDb25maWd1cmF0aW9uLmdldChjb25maWd1cmF0aW9uKVxuXG4gIGlmICghZGVkaWNhdGVkVGFibGVDYWNoZSkge1xuICAgIGRlZGljYXRlZFRhYmxlQ2FjaGUgPSBuZXcgTWFwKClcbiAgICBkZWRpY2F0ZWRUYWJsZUNhY2hlQnlDb25maWd1cmF0aW9uLnNldChjb25maWd1cmF0aW9uLCBkZWRpY2F0ZWRUYWJsZUNhY2hlKVxuICB9XG5cbiAgY29uc3QgY2FjaGVkID0gZGVkaWNhdGVkVGFibGVDYWNoZS5nZXQoY2FjaGVLZXkpXG5cbiAgaWYgKHR5cGVvZiBjYWNoZWQgPT09IFwiYm9vbGVhblwiKSB7XG4gICAgcmV0dXJuIGNhY2hlZFxuICB9XG5cbiAgY29uc3QgdGFibGUgPSBhd2FpdCBjb25uZWN0aW9uLmdldFRhYmxlQnlOYW1lKHRhYmxlTmFtZSwge3Rocm93RXJyb3I6IGZhbHNlfSlcbiAgY29uc3QgZXhpc3RzID0gQm9vbGVhbih0YWJsZSlcblxuICBkZWRpY2F0ZWRUYWJsZUNhY2hlLnNldChjYWNoZUtleSwgZXhpc3RzKVxuXG4gIHJldHVybiBleGlzdHNcbn1cblxuLyoqXG4gKiBSZXNvbHZlcyBhIGNhY2hlIGlkZW50aXR5IGZyb20gZXhwbGljaXQgb3BlcmF0aW9uIG93bmVyc2hpcCBvciB0aGUgYWN0dWFsXG4gKiBzdGFtcGVkIHBvb2wgY29ubmVjdGlvbi4gQW1iaWVudCB0ZW5hbnQgc3RhdGUgaXMgbmV2ZXIgdXNlZCB3aGVuIGFuXG4gKiBvcGVyYXRpb24gaXMgYXZhaWxhYmxlLlxuICogQHBhcmFtIHtBdWRpdGVkTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIEF1ZGl0ZWQgbW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBjb25uZWN0aW9uIC0gQWN0dWFsIGNvbm5lY3Rpb24uXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL29wZXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBbb3BlcmF0aW9uXSAtIEV4cGxpY2l0IG9wZXJhdGlvbi5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gUGh5c2ljYWwgZGF0YWJhc2UgaWRlbnRpdHkuXG4gKi9cbmZ1bmN0aW9uIGF1ZGl0RGF0YWJhc2VJZGVudGl0eShtb2RlbENsYXNzLCBjb25uZWN0aW9uLCBvcGVyYXRpb24pIHtcbiAgaWYgKG9wZXJhdGlvbikgcmV0dXJuIG9wZXJhdGlvbi5kYXRhYmFzZUlkZW50aXR5KClcblxuICBjb25zdCBkYXRhYmFzZUlkZW50aWZpZXIgPSBtb2RlbENsYXNzLmdldERhdGFiYXNlSWRlbnRpZmllcigpXG4gIGNvbnN0IHBvb2wgPSBtb2RlbENsYXNzLl9nZXRDb25maWd1cmF0aW9uKCkuZ2V0RGF0YWJhc2VQb29sKGRhdGFiYXNlSWRlbnRpZmllcilcblxuICByZXR1cm4gYCR7ZGF0YWJhc2VJZGVudGlmaWVyfToke3Bvb2wuZ2V0Q29ubmVjdGlvbkNvbmZpZ3VyYXRpb25SZXVzZUtleShjb25uZWN0aW9uKX1gXG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRHluYW1pYyBhdWRpdCBjbGFzc2VzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBSZXR1cm5zIGEgZnJhbWV3b3JrLW93bmVkIHNoYXJlZCBBdWRpdCBjbGFzcyBmb3IgdGhlIGBhdWRpdHNgIHRhYmxlLlxuICogVGhpcyBpcyBvbmx5IHVzZWQgd2hlbiBubyBjb25zdW1lci1yZWdpc3RlcmVkIEF1ZGl0IG1vZGVsIGV4aXN0cy5cbiAqIEBwYXJhbSB7QXVkaXRlZE1vZGVsQ2xhc3N9IG1vZGVsQ2xhc3MgLSBBbnkgYXVkaXRlZCBtb2RlbCBjbGFzcyAodXNlZCB0byBsb2NhdGUgRGF0YWJhc2VSZWNvcmQpLlxuICogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IFNoYXJlZCBBdWRpdCBtb2RlbCBjbGFzcy5cbiAqL1xuZnVuY3Rpb24gc2hhcmVkQXVkaXRDbGFzcyhtb2RlbENsYXNzKSB7XG4gIGNvbnN0IGRiUmVjb3JkQ2xhc3MgPSBmaW5kRGF0YWJhc2VSZWNvcmRDbGFzcyhtb2RlbENsYXNzKVxuXG4gIC8qKlxuICAgKiBGcmFtZXdvcmstb3duZWQgQXVkaXQgbW9kZWwgZm9yIHRoZSBzaGFyZWQgYGF1ZGl0c2AgdGFibGUuXG4gICAqL1xuICBjbGFzcyBBdWRpdCBleHRlbmRzIGRiUmVjb3JkQ2xhc3Mge1xuICAgIC8qKlxuICAgICAqIFJldHVybnMgdGhlIGJhY2tpbmcgdGFibGUgbmFtZS5cbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNoYXJlZCBgYXVkaXRzYCB0YWJsZSBuYW1lLlxuICAgICAqL1xuICAgIHN0YXRpYyB0YWJsZU5hbWUoKSB7XG4gICAgICByZXR1cm4gXCJhdWRpdHNcIlxuICAgIH1cbiAgfVxuXG4gIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShBdWRpdCwgXCJtb2RlbE5hbWVcIiwge3ZhbHVlOiBcIkF1ZGl0XCIsIHdyaXRhYmxlOiBmYWxzZX0pXG4gIGFwcGx5QXVkaXRDbGFzc0RhdGFiYXNlUm91dGluZyhtb2RlbENsYXNzLCBBdWRpdClcblxuICByZXR1cm4gLyoqIEB0eXBlIHt0eXBlb2YgaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSAqLyAoQXVkaXQpXG59XG5cbi8qKlxuICogUmV0dXJucyB0aGUgY2FjaGVkIGZyYW1ld29yay1vd25lZCBzaGFyZWQgQXVkaXQgY2xhc3MgZm9yIGEgZGF0YWJhc2UuXG4gKiBAcGFyYW0ge0F1ZGl0ZWRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gQW55IGF1ZGl0ZWQgbW9kZWwgY2xhc3MuXG4gKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gU2hhcmVkIEF1ZGl0IG1vZGVsIGNsYXNzLlxuICovXG5mdW5jdGlvbiBjYWNoZWRTaGFyZWRBdWRpdENsYXNzKG1vZGVsQ2xhc3MpIHtcbiAgY29uc3Qgcm91dGluZ0tleSA9IG1vZGVsQ2xhc3MuaGFzVGVuYW50RGF0YWJhc2VJZGVudGlmaWVyUmVzb2x2ZXIoKVxuICAgID8gYHRlbmFudDoke21vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCl9YFxuICAgIDogYGRhdGFiYXNlOiR7bW9kZWxDbGFzcy5nZXRDb25maWd1cmVkRGF0YWJhc2VJZGVudGlmaWVyKCl9YFxuICBjb25zdCBjYWNoZUtleSA9IGBzaGFyZWQ6JHtyb3V0aW5nS2V5fWBcbiAgbGV0IGF1ZGl0Q2xhc3MgPSBhdWRpdENsYXNzQ2FjaGUuZ2V0KGNhY2hlS2V5KVxuXG4gIGlmICghYXVkaXRDbGFzcykge1xuICAgIGF1ZGl0Q2xhc3MgPSBzaGFyZWRBdWRpdENsYXNzKG1vZGVsQ2xhc3MpXG4gICAgYXVkaXRDbGFzc0NhY2hlLnNldChjYWNoZUtleSwgYXVkaXRDbGFzcylcbiAgfVxuXG4gIHJldHVybiBhdWRpdENsYXNzXG59XG5cbi8qKlxuICogUmV0dXJucyBhIGR5bmFtaWMgcGVyLW1vZGVsIGF1ZGl0IGNsYXNzIGZvciBhIGRlZGljYXRlZCB0YWJsZS5cbiAqIEBwYXJhbSB7QXVkaXRlZE1vZGVsQ2xhc3N9IG1vZGVsQ2xhc3MgLSBBdWRpdGVkIG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtzdHJpbmd9IHRhYmxlTmFtZSAtIERlZGljYXRlZCBhdWRpdCB0YWJsZSBuYW1lIChlLmcuIFwicHJvamVjdF9hdWRpdHNcIikuXG4gKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gRGVkaWNhdGVkIGF1ZGl0IG1vZGVsIGNsYXNzLlxuICovXG5mdW5jdGlvbiBkZWRpY2F0ZWRBdWRpdENsYXNzKG1vZGVsQ2xhc3MsIHRhYmxlTmFtZSkge1xuICBjb25zdCBkYlJlY29yZENsYXNzID0gZmluZERhdGFiYXNlUmVjb3JkQ2xhc3MobW9kZWxDbGFzcylcbiAgY29uc3QgbW9kZWxOYW1lID0gbW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKVxuICBjb25zdCBtb2RlbEtleSA9IG1vZGVsUGFyYW1LZXkobW9kZWxDbGFzcylcblxuICAvKipcbiAgICogRnJhbWV3b3JrLW93bmVkIHBlci1tb2RlbCBBdWRpdCBjbGFzcy5cbiAgICovXG4gIGNsYXNzIE1vZGVsQXVkaXQgZXh0ZW5kcyBkYlJlY29yZENsYXNzIHtcbiAgICAvKipcbiAgICAgKiBSZXR1cm5zIHRoZSBiYWNraW5nIHRhYmxlIG5hbWUuXG4gICAgICogQHJldHVybnMge3N0cmluZ30gLSBEZWRpY2F0ZWQgYXVkaXQgdGFibGUgc3VwcGxpZWQgZm9yIHRoaXMgbW9kZWwgY2xhc3MuXG4gICAgICovXG4gICAgc3RhdGljIHRhYmxlTmFtZSgpIHtcbiAgICAgIHJldHVybiB0YWJsZU5hbWVcbiAgICB9XG4gIH1cblxuICBPYmplY3QuZGVmaW5lUHJvcGVydHkoTW9kZWxBdWRpdCwgXCJtb2RlbE5hbWVcIiwge3ZhbHVlOiBgJHttb2RlbE5hbWV9QXVkaXRgLCB3cml0YWJsZTogZmFsc2V9KVxuICBhcHBseUF1ZGl0Q2xhc3NEYXRhYmFzZVJvdXRpbmcobW9kZWxDbGFzcywgTW9kZWxBdWRpdClcbiAgTW9kZWxBdWRpdC5iZWxvbmdzVG8obW9kZWxLZXksIHtjbGFzc05hbWU6IG1vZGVsTmFtZX0pXG5cbiAgcmV0dXJuIC8qKiBAdHlwZSB7dHlwZW9mIGltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gKi8gKE1vZGVsQXVkaXQpXG59XG5cbi8qKlxuICogTWFrZXMgZnJhbWV3b3JrLW93bmVkIGF1ZGl0IGNsYXNzZXMgcmVhZCB0aGUgc2FtZSBkYXRhYmFzZSBhcyB0aGUgYXVkaXRlZCBtb2RlbC5cbiAqIEBwYXJhbSB7QXVkaXRlZE1vZGVsQ2xhc3N9IG1vZGVsQ2xhc3MgLSBBdWRpdGVkIHNvdXJjZSBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gYXVkaXRDbGFzcyAtIEdlbmVyYXRlZCBhdWRpdCBjbGFzcy5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBhcHBseUF1ZGl0Q2xhc3NEYXRhYmFzZVJvdXRpbmcobW9kZWxDbGFzcywgYXVkaXRDbGFzcykge1xuICBhdWRpdENsYXNzLnNldERhdGFiYXNlSWRlbnRpZmllcihtb2RlbENsYXNzLmdldENvbmZpZ3VyZWREYXRhYmFzZUlkZW50aWZpZXIoKSlcblxuICBpZiAobW9kZWxDbGFzcy5oYXNUZW5hbnREYXRhYmFzZUlkZW50aWZpZXJSZXNvbHZlcigpKSB7XG4gICAgYXVkaXRDbGFzcy5zd2l0Y2hlc1RlbmFudERhdGFiYXNlKCh7dGVuYW50fSkgPT4gbW9kZWxDbGFzcy5nZXRUZW5hbnREYXRhYmFzZUlkZW50aWZpZXIodGVuYW50KSlcbiAgfVxufVxuXG4vKipcbiAqIFdhbGtzIHRoZSBwcm90b3R5cGUgY2hhaW4gdG8gZmluZCB0aGUgcm9vdCBEYXRhYmFzZVJlY29yZCBjbGFzcy5cbiAqIEBwYXJhbSB7QXVkaXRlZE1vZGVsQ2xhc3N9IG1vZGVsQ2xhc3MgLSBBdWRpdGVkIG1vZGVsIGNsYXNzLlxuICogQHJldHVybnMge3R5cGVvZiBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IFJvb3QgRGF0YWJhc2VSZWNvcmQgY2xhc3MuXG4gKi9cbmZ1bmN0aW9uIGZpbmREYXRhYmFzZVJlY29yZENsYXNzKG1vZGVsQ2xhc3MpIHtcbiAgbGV0IHJlY29yZENsYXNzID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKG1vZGVsQ2xhc3MpXG5cbiAgd2hpbGUgKHJlY29yZENsYXNzICYmIE9iamVjdC5nZXRQcm90b3R5cGVPZihyZWNvcmRDbGFzcykgIT09IEZ1bmN0aW9uLnByb3RvdHlwZSkge1xuICAgIHJlY29yZENsYXNzID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKHJlY29yZENsYXNzKVxuICB9XG5cbiAgcmV0dXJuIC8qKiBAdHlwZSB7dHlwZW9mIGltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gKi8gKHJlY29yZENsYXNzKVxufVxuXG4vKipcbiAqIFJldHVybnMgdGhlIHBhcmFtZXRlci1rZXkgbmFtZSBmb3IgYSBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7QXVkaXRlZE1vZGVsQ2xhc3N9IG1vZGVsQ2xhc3MgLSBBdWRpdGVkIG1vZGVsIGNsYXNzLlxuICogQHJldHVybnMge3N0cmluZ30gZS5nLiBcInByb2plY3RcIiBmb3IgXCJQcm9qZWN0XCIuXG4gKi9cbmZ1bmN0aW9uIG1vZGVsUGFyYW1LZXkobW9kZWxDbGFzcykge1xuICBjb25zdCBuYW1lID0gbW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKVxuXG4gIHJldHVybiBuYW1lLmNoYXJBdCgwKS50b0xvd2VyQ2FzZSgpICsgbmFtZS5zbGljZSgxKVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIFJlZ2lzdHJhdGlvbiAoc3luYyDigJQgY2FsbGJhY2tzIG9ubHk7IHRhYmxlIGRldGVjdGlvbiBkZWZlcnJlZClcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFJlZ2lzdGVycyBsaWZlY3ljbGUgY2FsbGJhY2tzIGZvciBhdXRvbWF0aWMgY3JlYXRlL3VwZGF0ZS9kZXN0cm95IGF1ZGl0aW5nLlxuICogVGFibGUgZGV0ZWN0aW9uIGFuZCByZWxhdGlvbnNoaXAgcmVnaXN0cmF0aW9uIGhhcHBlbiBsYXppbHkgb24gZmlyc3QgdXNhZ2UuXG4gKiBDYWxsZWQgc3luY2hyb25vdXNseSBmcm9tIE1vZGVsLmF1ZGl0ZWQoKSBhdCBtb2R1bGUtbG9hZCB0aW1lLlxuICogQHBhcmFtIHtBdWRpdGVkTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzIHRvIGF1ZGl0LlxuICogQHBhcmFtIHt7ZXhjZXB0Pzogc3RyaW5nW119fSBbb3B0aW9uc10gLSBBdWRpdCBvcHRpb25zOiBgZXhjZXB0YCBsaXN0cyBhdHRyaWJ1dGUgbmFtZXMgbmV2ZXIgd3JpdHRlbiB0byB0aGUgYXVkaXQgdHJhaWwgKGUuZy4gaGlnaC1mcmVxdWVuY3kgdGVsZW1ldHJ5IGNvbHVtbnMpLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIHJlZ2lzdGVyQXVkaXRpbmcobW9kZWxDbGFzcywgb3B0aW9ucyA9IHt9KSB7XG4gIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwobW9kZWxDbGFzcywgXCJfYXVkaXRMaWZlY3ljbGVDYWxsYmFja3NSZWdpc3RlcmVkXCIpICYmIG1vZGVsQ2xhc3MuX2F1ZGl0TGlmZWN5Y2xlQ2FsbGJhY2tzUmVnaXN0ZXJlZCkge1xuICAgIHJldHVyblxuICB9XG5cbiAgY29uc3QgYXVkaXRhYmxlTW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7QXVkaXRlZE1vZGVsQ2xhc3MgJiB7X2F1ZGl0RXhjbHVkZWRBdHRyaWJ1dGVzPzogU2V0PHN0cmluZz59fSAqLyAobW9kZWxDbGFzcylcblxuICBhdWRpdGFibGVNb2RlbENsYXNzLl9hdWRpdExpZmVjeWNsZUNhbGxiYWNrc1JlZ2lzdGVyZWQgPSB0cnVlXG4gIGF1ZGl0YWJsZU1vZGVsQ2xhc3MuX2F1ZGl0RXhjbHVkZWRBdHRyaWJ1dGVzID0gbmV3IFNldChvcHRpb25zLmV4Y2VwdCB8fCBbXSlcbiAgcmVnaXN0ZXJBdWRpdFJlbGF0aW9uc2hpcChtb2RlbENsYXNzKVxuICBtb2RlbENsYXNzLmJlZm9yZUNyZWF0ZShcImNhcHR1cmVDcmVhdGVBdWRpdENoYW5nZXNcIilcbiAgbW9kZWxDbGFzcy5hZnRlckNyZWF0ZShcImNyZWF0ZUNyZWF0ZUF1ZGl0XCIpXG4gIG1vZGVsQ2xhc3MuYmVmb3JlVXBkYXRlKFwiY2FwdHVyZVVwZGF0ZUF1ZGl0Q2hhbmdlc1wiKVxuICBtb2RlbENsYXNzLmFmdGVyVXBkYXRlKFwiY3JlYXRlVXBkYXRlQXVkaXRcIilcbiAgbW9kZWxDbGFzcy5hZnRlckRlc3Ryb3koXCJjcmVhdGVEZXN0cm95QXVkaXRcIilcbn1cblxuLyoqXG4gKiBJbml0aWFsaXplcyBhdWRpdCBtZXRhZGF0YSBmb3IgYXVkaXRlZCBtb2RlbCBjbGFzc2VzLlxuICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MgdG8gaW5pdGlhbGl6ZS5cbiAqIEBwYXJhbSB7e3Jlc29sdmVUYWJsZURhdGE/OiBib29sZWFufX0gW2FyZ3NdIC0gSW5pdGlhbGl6YXRpb24gb3B0aW9ucy5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICovXG5hc3luYyBmdW5jdGlvbiBpbml0aWFsaXplQXVkaXRpbmcobW9kZWxDbGFzcywgYXJncyA9IHt9KSB7XG4gIGNvbnN0IHtyZXNvbHZlVGFibGVEYXRhID0gZmFsc2V9ID0gYXJnc1xuICBjb25zdCBhdWRpdGVkTW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7QXVkaXRlZE1vZGVsQ2xhc3N9ICovIChtb2RlbENsYXNzKVxuXG4gIGlmICghYXVkaXRlZE1vZGVsQ2xhc3MuX2F1ZGl0TGlmZWN5Y2xlQ2FsbGJhY2tzUmVnaXN0ZXJlZCkge1xuICAgIHJldHVyblxuICB9XG5cbiAgcmVnaXN0ZXJBdWRpdFJlbGF0aW9uc2hpcChhdWRpdGVkTW9kZWxDbGFzcylcblxuICBpZiAocmVzb2x2ZVRhYmxlRGF0YSAmJiBzaG91bGRSZXNvbHZlQXVkaXRUYWJsZURhdGEoYXVkaXRlZE1vZGVsQ2xhc3MpKSB7XG4gICAgYXdhaXQgcmVzb2x2ZUF1ZGl0VGFibGVEYXRhKGF1ZGl0ZWRNb2RlbENsYXNzKVxuICB9XG59XG5cbi8qKlxuICogUmVzb2x2ZXMgYXVkaXQgbWV0YWRhdGEgYWZ0ZXIgYXBwbGljYXRpb24gYW5kIHBhY2thZ2UgbW9kZWwgY2xhc3NlcyBhcmUgcmVnaXN0ZXJlZC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBjb25maWd1cmF0aW9uIC0gQ29uZmlndXJhdGlvbiB3aG9zZSBtb2RlbHMgc2hvdWxkIGJlIGZpbmFsaXplZC5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICovXG5hc3luYyBmdW5jdGlvbiBpbml0aWFsaXplQXVkaXRlZE1vZGVsUmVsYXRpb25zaGlwcyhjb25maWd1cmF0aW9uKSB7XG4gIGNvbnN0IG1vZGVsQ2xhc3NlcyA9IE9iamVjdC52YWx1ZXMoY29uZmlndXJhdGlvbi5nZXRNb2RlbENsYXNzZXMoKSlcbiAgY29uc3Qgc2hvdWxkUmVzb2x2ZVRhYmxlRGF0YSA9IG1vZGVsQ2xhc3Nlcy5zb21lKChtb2RlbENsYXNzKSA9PiBzaG91bGRSZXNvbHZlQXVkaXRUYWJsZURhdGEobW9kZWxDbGFzcykpXG5cbiAgaWYgKCFzaG91bGRSZXNvbHZlVGFibGVEYXRhKSB7XG4gICAgZm9yIChjb25zdCBtb2RlbENsYXNzIG9mIG1vZGVsQ2xhc3Nlcykge1xuICAgICAgYXdhaXQgaW5pdGlhbGl6ZUF1ZGl0aW5nKG1vZGVsQ2xhc3MpXG4gICAgfVxuXG4gICAgcmV0dXJuXG4gIH1cblxuICBhd2FpdCBjb25maWd1cmF0aW9uLmVuc3VyZUNvbm5lY3Rpb25zKHtuYW1lOiBcIkluaXRpYWxpemUgYXVkaXRlZCBtb2RlbCByZWxhdGlvbnNoaXBzXCJ9LCBhc3luYyAoKSA9PiB7XG4gICAgZm9yIChjb25zdCBtb2RlbENsYXNzIG9mIG1vZGVsQ2xhc3Nlcykge1xuICAgICAgYXdhaXQgaW5pdGlhbGl6ZUF1ZGl0aW5nKG1vZGVsQ2xhc3MsIHtyZXNvbHZlVGFibGVEYXRhOiB0cnVlfSlcbiAgICB9XG4gIH0pXG59XG5cbi8qKlxuICogQ2hlY2tzIHdoZXRoZXIgYXVkaXQgdGFibGUgbWV0YWRhdGEgc2hvdWxkIGJlIHJlc29sdmVkIGZvciBhIG1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MgdG8gaW5zcGVjdC5cbiAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIHRhYmxlIG1ldGFkYXRhIHJlc29sdXRpb24gc2hvdWxkIHJ1biBub3cuXG4gKi9cbmZ1bmN0aW9uIHNob3VsZFJlc29sdmVBdWRpdFRhYmxlRGF0YShtb2RlbENsYXNzKSB7XG4gIGNvbnN0IGF1ZGl0ZWRNb2RlbENsYXNzID0gLyoqIEB0eXBlIHtBdWRpdGVkTW9kZWxDbGFzc30gKi8gKG1vZGVsQ2xhc3MpXG5cbiAgaWYgKCFhdWRpdGVkTW9kZWxDbGFzcy5fYXVkaXRMaWZlY3ljbGVDYWxsYmFja3NSZWdpc3RlcmVkKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICByZXR1cm4gQm9vbGVhbihhdWRpdGVkTW9kZWxDbGFzcy5faW5pdGlhbGl6ZWQpICYmIGNhblJlc29sdmVBdWRpdFRhYmxlRGF0YShhdWRpdGVkTW9kZWxDbGFzcylcbn1cblxuLyoqXG4gKiBSZWdpc3RlcnMgdGhlIGF1ZGl0cyByZWxhdGlvbnNoaXAgd2l0aG91dCBmb3JjaW5nIGF1ZGl0IHRhYmxlIGRldGVjdGlvbi5cbiAqIEBwYXJhbSB7QXVkaXRlZE1vZGVsQ2xhc3N9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcyB0byBhdWRpdC5cbiAqIEBwYXJhbSB7QXVkaXRUYWJsZURhdGF9IFt0YWJsZURhdGFdIC0gUmVzb2x2ZWQgYXVkaXQgdGFibGUgZGF0YSB3aGVuIGF2YWlsYWJsZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBbZGF0YWJhc2VJZGVudGl0eV0gLSBSZXNvbHZlZCBwaHlzaWNhbCBkYXRhYmFzZSBpZGVudGl0eS5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiByZWdpc3RlckF1ZGl0UmVsYXRpb25zaGlwKG1vZGVsQ2xhc3MsIHRhYmxlRGF0YSA9IGRlZmF1bHRBdWRpdFJlbGF0aW9uc2hpcFRhYmxlRGF0YShtb2RlbENsYXNzKSwgZGF0YWJhc2VJZGVudGl0eSkge1xuICBpZiAobW9kZWxDbGFzcy5fcmVsYXRpb25zaGlwRXhpc3RzKFwiYXVkaXRzXCIpKSB7XG4gICAgY29uc3QgcmVsYXRpb25zaGlwID0gbW9kZWxDbGFzcy5nZXRSZWxhdGlvbnNoaXBCeU5hbWUoXCJhdWRpdHNcIilcblxuICAgIGlmIChnZW5lcmF0ZWRBdWRpdFJlbGF0aW9uc2hpcHMuaGFzKHJlbGF0aW9uc2hpcCkgJiYgZGF0YWJhc2VJZGVudGl0eSkge1xuICAgICAgYXVkaXRSZWxhdGlvbnNoaXBNYXAobW9kZWxDbGFzcykuc2V0KGRhdGFiYXNlSWRlbnRpdHksIGJ1aWxkQXVkaXRSZWxhdGlvbnNoaXAobW9kZWxDbGFzcywgdGFibGVEYXRhKSlcbiAgICB9XG5cbiAgICByZXR1cm5cbiAgfVxuXG4gIG1vZGVsQ2xhc3MuaGFzTWFueShcImF1ZGl0c1wiLCBhdWRpdFJlbGF0aW9uc2hpcFNjb3BlLCB7XG4gICAgZm9yZWlnbktleTogdGFibGVEYXRhLmZvcmVpZ25LZXksXG4gICAga2xhc3M6IHRhYmxlRGF0YS5hdWRpdENsYXNzLFxuICAgIHBvbHltb3JwaGljOiAhdGFibGVEYXRhLmRlZGljYXRlZFxuICB9KVxuICBjb25zdCByZWxhdGlvbnNoaXAgPSBtb2RlbENsYXNzLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShcImF1ZGl0c1wiKVxuXG4gIGdlbmVyYXRlZEF1ZGl0UmVsYXRpb25zaGlwcy5hZGQocmVsYXRpb25zaGlwKVxuICByZWxhdGlvbnNoaXAuc2V0UmVjb3JkUmVzb2x2ZXIoKHJlY29yZCkgPT4ge1xuICAgIGNvbnN0IHJlbGF0aW9uc2hpcHMgPSBhdWRpdFJlbGF0aW9uc2hpcE1hcChtb2RlbENsYXNzKVxuICAgIGNvbnN0IG9wZXJhdGlvbiA9IHJlY29yZC5kYXRhYmFzZU9wZXJhdGlvbigpXG5cbiAgICBpZiAob3BlcmF0aW9uKSByZXR1cm4gcmVsYXRpb25zaGlwcy5nZXQob3BlcmF0aW9uLmRhdGFiYXNlSWRlbnRpdHkoKSkgfHwgcmVsYXRpb25zaGlwXG4gICAgaWYgKHJlbGF0aW9uc2hpcHMuc2l6ZSA9PT0gMSkgcmV0dXJuIFsuLi5yZWxhdGlvbnNoaXBzLnZhbHVlcygpXVswXVxuXG4gICAgY29uc3QgaWRlbnRpdHkgPSBhdWRpdERhdGFiYXNlSWRlbnRpdHkobW9kZWxDbGFzcywgcmVjb3JkLmNvbm5lY3Rpb24oKSlcblxuICAgIHJldHVybiByZWxhdGlvbnNoaXBzLmdldChpZGVudGl0eSkgfHwgcmVsYXRpb25zaGlwXG4gIH0pXG59XG5cbi8qKlxuICogUmV0dXJucyBwaHlzaWNhbCBhdWRpdCByZWxhdGlvbnNoaXAgdmFyaWFudHMgZm9yIGEgbW9kZWwuXG4gKiBAcGFyYW0ge0F1ZGl0ZWRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gQXVkaXRlZCBtb2RlbCBjbGFzcy5cbiAqIEByZXR1cm5zIHtNYXA8c3RyaW5nLCBIYXNNYW55UmVsYXRpb25zaGlwPn0gLSBSZWxhdGlvbnNoaXBzIGtleWVkIGJ5IHBoeXNpY2FsIGRhdGFiYXNlIGlkZW50aXR5LlxuICovXG5mdW5jdGlvbiBhdWRpdFJlbGF0aW9uc2hpcE1hcChtb2RlbENsYXNzKSB7XG4gIGxldCByZWxhdGlvbnNoaXBzID0gYXVkaXRSZWxhdGlvbnNoaXBzQnlNb2RlbC5nZXQobW9kZWxDbGFzcylcblxuICBpZiAoIXJlbGF0aW9uc2hpcHMpIHtcbiAgICByZWxhdGlvbnNoaXBzID0gbmV3IE1hcCgpXG4gICAgYXVkaXRSZWxhdGlvbnNoaXBzQnlNb2RlbC5zZXQobW9kZWxDbGFzcywgcmVsYXRpb25zaGlwcylcbiAgfVxuXG4gIHJldHVybiByZWxhdGlvbnNoaXBzXG59XG5cbi8qKlxuICogQnVpbGRzIGltbXV0YWJsZS1ieS1vd25lcnNoaXAgYXVkaXQgcmVsYXRpb25zaGlwIG1ldGFkYXRhIGZvciBvbmUgcGh5c2ljYWwgZGF0YWJhc2UuXG4gKiBAcGFyYW0ge0F1ZGl0ZWRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gQXVkaXRlZCBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7QXVkaXRUYWJsZURhdGF9IHRhYmxlRGF0YSAtIFJlc29sdmVkIGF1ZGl0IHRhYmxlIGRhdGEuXG4gKiBAcmV0dXJucyB7SGFzTWFueVJlbGF0aW9uc2hpcH0gLSBQaHlzaWNhbCByZWxhdGlvbnNoaXAgZGVmaW5pdGlvbi5cbiAqL1xuZnVuY3Rpb24gYnVpbGRBdWRpdFJlbGF0aW9uc2hpcChtb2RlbENsYXNzLCB0YWJsZURhdGEpIHtcbiAgcmV0dXJuIG5ldyBIYXNNYW55UmVsYXRpb25zaGlwKHtcbiAgICBmb3JlaWduS2V5OiB0YWJsZURhdGEuZm9yZWlnbktleSxcbiAgICBrbGFzczogdGFibGVEYXRhLmF1ZGl0Q2xhc3MsXG4gICAgbW9kZWxDbGFzcyxcbiAgICBwb2x5bW9ycGhpYzogIXRhYmxlRGF0YS5kZWRpY2F0ZWQsXG4gICAgcmVsYXRpb25zaGlwTmFtZTogXCJhdWRpdHNcIixcbiAgICBzY29wZTogYXVkaXRSZWxhdGlvbnNoaXBTY29wZSxcbiAgICB0eXBlOiBcImhhc01hbnlcIlxuICB9KVxufVxuXG4vKipcbiAqIFJldHVybnMgdW5yZXNvbHZlZCBzaGFyZWQtYXVkaXQgZGVmYXVsdHMgZm9yIGVhcmx5IHJlbGF0aW9uc2hpcCByZWdpc3RyYXRpb24uXG4gKiBAcGFyYW0ge0F1ZGl0ZWRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MgdG8gYXVkaXQuXG4gKiBAcmV0dXJucyB7QXVkaXRUYWJsZURhdGF9IFNoYXJlZCBhdWRpdCByZWxhdGlvbnNoaXAgZGVmYXVsdHMuXG4gKi9cbmZ1bmN0aW9uIGRlZmF1bHRBdWRpdFJlbGF0aW9uc2hpcFRhYmxlRGF0YShtb2RlbENsYXNzKSB7XG4gIHJldHVybiB7XG4gICAgYXVkaXRDbGFzczogY2FjaGVkU2hhcmVkQXVkaXRDbGFzcyhtb2RlbENsYXNzKSxcbiAgICBkZWRpY2F0ZWQ6IGZhbHNlLFxuICAgIGZvcmVpZ25LZXk6IFwiYXVkaXRhYmxlX2lkXCIsXG4gICAgdGFibGVOYW1lOiBcImF1ZGl0c1wiXG4gIH1cbn1cblxuLyoqXG4gKiBBcHBsaWVzIGRlZmF1bHQgYXVkaXQgb3JkZXJpbmcgdG8gZ2VuZXJhdGVkIGF1ZGl0IHJlbGF0aW9uc2hpcHMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8dHlwZW9mIGltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdD59IHF1ZXJ5IC0gQXVkaXQgcXVlcnkuXG4gKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vcXVlcnkvbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdDx0eXBlb2YgaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gT3JkZXJlZCBhdWRpdCBxdWVyeS5cbiAqL1xuZnVuY3Rpb24gYXVkaXRSZWxhdGlvbnNoaXBTY29wZShxdWVyeSkge1xuICByZXR1cm4gcXVlcnkub3JkZXIoe2NvbHVtbjogXCJjcmVhdGVkX2F0XCIsIGRpcmVjdGlvbjogXCJERVNDXCJ9KVxufVxuXG4vKipcbiAqIENoZWNrcyB3aGV0aGVyIHRoZSBjdXJyZW50IHRlbmFudCBjb250ZXh0IGNhbiByZXNvbHZlIGF1ZGl0IHRhYmxlIGRhdGEuXG4gKiBAcGFyYW0ge0F1ZGl0ZWRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MgdG8gaW5zcGVjdC5cbiAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIGF1ZGl0IHRhYmxlIGRhdGEgY2FuIGJlIHJlc29sdmVkIGluIHRoZSBjdXJyZW50IHNjb3BlLlxuICovXG5mdW5jdGlvbiBjYW5SZXNvbHZlQXVkaXRUYWJsZURhdGEobW9kZWxDbGFzcykge1xuICBpZiAoIW1vZGVsQ2xhc3MuaGFzVGVuYW50RGF0YWJhc2VJZGVudGlmaWVyUmVzb2x2ZXIoKSkge1xuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICBjb25zdCB0ZW5hbnREYXRhYmFzZUlkZW50aWZpZXIgPSBtb2RlbENsYXNzLmdldFRlbmFudERhdGFiYXNlSWRlbnRpZmllcigpXG5cbiAgaWYgKCF0ZW5hbnREYXRhYmFzZUlkZW50aWZpZXIpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIHJldHVybiBtb2RlbENsYXNzLl9nZXRDb25maWd1cmF0aW9uKCkuaXNEYXRhYmFzZUlkZW50aWZpZXJBY3RpdmUodGVuYW50RGF0YWJhc2VJZGVudGlmaWVyKVxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIENyZWF0aW5nIGF1ZGl0c1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogQ3JlYXRlcyBhbiBhdWRpdCByb3cgZm9yIGEgcmVjb3JkLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IHJlY29yZCAtIFJlY29yZCB0byBhdWRpdC5cbiAqIEBwYXJhbSB7Q3JlYXRlQXVkaXRBcmdzfSBhcmdzIC0gQXVkaXQgcm93IG9wdGlvbnMgKGFjdGlvbiwgYXVkaXRlZENoYW5nZXMsIHBhcmFtcykuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxudW1iZXIgfCBzdHJpbmc+fSBDcmVhdGVkIGF1ZGl0IHJvdyBpZC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gY3JlYXRlQXVkaXQocmVjb3JkLCBhcmdzKSB7XG4gIGNvbnN0IG1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge0F1ZGl0ZWRNb2RlbENsYXNzfSAqLyAocmVjb3JkLmdldE1vZGVsQ2xhc3MoKSlcbiAgY29uc3Qgb3BlcmF0aW9uID0gcmVjb3JkLmRhdGFiYXNlT3BlcmF0aW9uKClcblxuICBpZiAob3BlcmF0aW9uKSByZXR1cm4gYXdhaXQgY3JlYXRlQXVkaXRXaXRoQ3VycmVudENvbm5lY3Rpb24ocmVjb3JkLCBhcmdzLCBtb2RlbENsYXNzKVxuXG4gIHJldHVybiBhd2FpdCBtb2RlbENsYXNzLl9nZXRDb25maWd1cmF0aW9uKCkuZW5zdXJlQ29ubmVjdGlvbnMoe25hbWU6IGAke21vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCl9IGF1ZGl0YH0sIGFzeW5jICgpID0+IHtcbiAgICByZXR1cm4gYXdhaXQgY3JlYXRlQXVkaXRXaXRoQ3VycmVudENvbm5lY3Rpb24ocmVjb3JkLCBhcmdzLCBtb2RlbENsYXNzKVxuICB9KVxufVxuXG4vKipcbiAqIENyZWF0ZXMgYW4gYXVkaXQgcm93IHVzaW5nIHRoZSBjdXJyZW50IG1vZGVsIGRhdGFiYXNlIGNvbm5lY3Rpb24uXG4gKiBSb3V0ZXMgdG8gc2hhcmVkIHRhYmxlIG9yIGRlZGljYXRlZCB0YWJsZSBiYXNlZCBvbiByZXNvbHZlZCBhdWRpdCB0YWJsZSBkYXRhLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IHJlY29yZCAtIFJlY29yZCB0byBhdWRpdC5cbiAqIEBwYXJhbSB7Q3JlYXRlQXVkaXRBcmdzfSBhcmdzIC0gQXVkaXQgcm93IG9wdGlvbnMgKGFjdGlvbiwgYXVkaXRlZENoYW5nZXMsIHBhcmFtcykuXG4gKiBAcGFyYW0ge0F1ZGl0ZWRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gQXVkaXRlZCBtb2RlbCBjbGFzcy5cbiAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlciB8IHN0cmluZz59IENyZWF0ZWQgYXVkaXQgcm93IGlkLlxuICovXG5hc3luYyBmdW5jdGlvbiBjcmVhdGVBdWRpdFdpdGhDdXJyZW50Q29ubmVjdGlvbihyZWNvcmQsIGFyZ3MsIG1vZGVsQ2xhc3MpIHtcbiAgaWYgKCFyZWNvcmQuaXNQZXJzaXN0ZWQoKSkgdGhyb3cgbmV3IEVycm9yKGBDYW5ub3QgYXVkaXQgdW5wZXJzaXN0ZWQgJHttb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpfSByZWNvcmRgKVxuXG4gIGNvbnN0IGRiID0gcmVjb3JkLmNvbm5lY3Rpb24oKVxuICBjb25zdCB0YWJsZURhdGEgPSBhd2FpdCByZXNvbHZlQXVkaXRUYWJsZURhdGEobW9kZWxDbGFzcywgZGIsIHJlY29yZC5kYXRhYmFzZU9wZXJhdGlvbigpKVxuICBjb25zdCBhY3Rpb24gPSBub3JtYWxpemVBY3Rpb24oYXJncy5hY3Rpb24pXG4gIGNvbnN0IGF1ZGl0ZWRDaGFuZ2VzID0gYXJncy5hdWRpdGVkQ2hhbmdlcyA9PT0gdW5kZWZpbmVkID8gbnVsbCA6IGFyZ3MuYXVkaXRlZENoYW5nZXNcbiAgY29uc3QgcGFyYW1zID0gYXJncy5wYXJhbXMgPT09IHVuZGVmaW5lZCA/IG51bGwgOiBhcmdzLnBhcmFtc1xuICBjb25zdCBjdXJyZW50RGF0ZSA9IG5ldyBEYXRlKClcbiAgY29uc3QgcmVjb3JkSWQgPSBzY2FsYXJNb2RlbFByaW1hcnlLZXlWYWx1ZShyZWNvcmQuaWQoKSwgYEF1ZGl0aW5nIGZvciAke21vZGVsQ2xhc3MubmFtZX1gKVxuXG4gIGNvbnN0IGF1ZGl0QWN0aW9uSWQgPSBhd2FpdCBmaW5kT3JDcmVhdGVMb29rdXBJZCh7XG4gICAgY29sdW1uTmFtZTogXCJhY3Rpb25cIixcbiAgICBjdXJyZW50RGF0ZSxcbiAgICBkYixcbiAgICB0YWJsZU5hbWU6IFwiYXVkaXRfYWN0aW9uc1wiLFxuICAgIHZhbHVlOiBhY3Rpb25cbiAgfSlcblxuICBjb25zdCBhdWRpdElkID0gbmV3IFVVSUQoNCkuZm9ybWF0KClcblxuICBpZiAodGFibGVEYXRhLmRlZGljYXRlZCkge1xuICAgIGNvbnN0IG1vZGVsS2V5ID0gbW9kZWxQYXJhbUtleShtb2RlbENsYXNzKVxuXG4gICAgYXdhaXQgZGIucXVlcnkoZGIuaW5zZXJ0U3FsKHtcbiAgICAgIHJldHVybkxhc3RJbnNlcnRlZENvbHVtbk5hbWVzOiBbXCJpZFwiXSxcbiAgICAgIHRhYmxlTmFtZTogdGFibGVEYXRhLnRhYmxlTmFtZSxcbiAgICAgIGRhdGE6IHtcbiAgICAgICAgaWQ6IGF1ZGl0SWQsXG4gICAgICAgIFtgJHttb2RlbEtleX1faWRgXTogcmVjb3JkSWQsXG4gICAgICAgIGF1ZGl0X2FjdGlvbl9pZDogYXVkaXRBY3Rpb25JZCxcbiAgICAgICAgYXVkaXRlZF9jaGFuZ2VzOiBhdWRpdGVkQ2hhbmdlcyxcbiAgICAgICAgcGFyYW1zLFxuICAgICAgICBjcmVhdGVkX2F0OiBjdXJyZW50RGF0ZSxcbiAgICAgICAgdXBkYXRlZF9hdDogY3VycmVudERhdGVcbiAgICAgIH1cbiAgICB9KSlcbiAgfSBlbHNlIHtcbiAgICBjb25zdCBhdWRpdEF1ZGl0YWJsZVR5cGVJZCA9IGF3YWl0IGZpbmRPckNyZWF0ZUxvb2t1cElkKHtcbiAgICAgIGNvbHVtbk5hbWU6IFwibmFtZVwiLFxuICAgICAgY3VycmVudERhdGUsXG4gICAgICBkYixcbiAgICAgIHRhYmxlTmFtZTogXCJhdWRpdF9hdWRpdGFibGVfdHlwZXNcIixcbiAgICAgIHZhbHVlOiBtb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpXG4gICAgfSlcblxuICAgIGF3YWl0IGRiLnF1ZXJ5KGRiLmluc2VydFNxbCh7XG4gICAgICByZXR1cm5MYXN0SW5zZXJ0ZWRDb2x1bW5OYW1lczogW1wiaWRcIl0sXG4gICAgICB0YWJsZU5hbWU6IFwiYXVkaXRzXCIsXG4gICAgICBkYXRhOiB7XG4gICAgICAgIGlkOiBhdWRpdElkLFxuICAgICAgICBhdWRpdF9hY3Rpb25faWQ6IGF1ZGl0QWN0aW9uSWQsXG4gICAgICAgIGF1ZGl0X2F1ZGl0YWJsZV90eXBlX2lkOiBhdWRpdEF1ZGl0YWJsZVR5cGVJZCxcbiAgICAgICAgYXVkaXRhYmxlX2lkOiByZWNvcmRJZCxcbiAgICAgICAgYXVkaXRhYmxlX3R5cGU6IG1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCksXG4gICAgICAgIGF1ZGl0ZWRfY2hhbmdlczogYXVkaXRlZENoYW5nZXMsXG4gICAgICAgIHBhcmFtcyxcbiAgICAgICAgY3JlYXRlZF9hdDogY3VycmVudERhdGUsXG4gICAgICAgIHVwZGF0ZWRfYXQ6IGN1cnJlbnREYXRlXG4gICAgICB9XG4gICAgfSkpXG4gIH1cblxuICBhd2FpdCBlbWl0QXVkaXRFdmVudChtb2RlbENsYXNzLCBhY3Rpb24sIHtcbiAgICBhY3Rpb24sXG4gICAgYXVkaXRJZCxcbiAgICBhdWRpdGVkQ2hhbmdlcyxcbiAgICBwYXJhbXMsXG4gICAgcmVjb3JkXG4gIH0pXG5cbiAgQXVkaXRFdmVudHMuY2FsbChtb2RlbENsYXNzLmdldE1vZGVsTmFtZSgpLCBhY3Rpb24sIHtcbiAgICBhY3Rpb24sXG4gICAgYXVkaXRJZCxcbiAgICBhdWRpdGVkQ2hhbmdlcyxcbiAgICBwYXJhbXMsXG4gICAgcmVjb3JkXG4gIH0pXG5cbiAgcmV0dXJuIGF1ZGl0SWRcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBMaWZlY3ljbGUgY2FsbGJhY2tzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBDYXB0dXJlcyBjcmVhdGUgY2hhbmdlcyBiZWZvcmUgcGVyc2lzdGVuY2UgY2xlYXJzIHRoZSBjaGFuZ2Ugc2V0LlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHQgJiB7X3BlbmRpbmdDcmVhdGVBdWRpdENoYW5nZXM/OiBBdWRpdENoYW5nZXN9fSByZWNvcmQgLSBSZWNvcmQgd2hvc2UgcGVuZGluZyBjaGFuZ2VzIHNob3VsZCBiZSBjYXB0dXJlZC5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBjYXB0dXJlQ3JlYXRlQXVkaXRDaGFuZ2VzKHJlY29yZCkge1xuICByZWNvcmQuX3BlbmRpbmdDcmVhdGVBdWRpdENoYW5nZXMgPSBhdWRpdENoYW5nZXNGb3JDdXJyZW50Q2hhbmdlcyhyZWNvcmQpXG59XG5cbi8qKlxuICogV3JpdGVzIHRoZSBjcmVhdGUgYXVkaXQgcm93IGZvciBhIG1vZGVsIGluc3RhbmNlLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHQgJiB7X3BlbmRpbmdDcmVhdGVBdWRpdENoYW5nZXM/OiBBdWRpdENoYW5nZXN9fSByZWNvcmQgLSBSZWNvcmQgdG8gYXVkaXQuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAqL1xuYXN5bmMgZnVuY3Rpb24gY3JlYXRlQ3JlYXRlQXVkaXQocmVjb3JkKSB7XG4gIGF3YWl0IGNyZWF0ZUF1ZGl0KHJlY29yZCwge1xuICAgIGFjdGlvbjogXCJjcmVhdGVcIixcbiAgICBhdWRpdGVkQ2hhbmdlczogcmVjb3JkLl9wZW5kaW5nQ3JlYXRlQXVkaXRDaGFuZ2VzIHx8IG51bGxcbiAgfSlcblxuICByZWNvcmQuX3BlbmRpbmdDcmVhdGVBdWRpdENoYW5nZXMgPSB1bmRlZmluZWRcbn1cblxuLyoqXG4gKiBDYXB0dXJlcyB1cGRhdGUgY2hhbmdlcyBiZWZvcmUgcGVyc2lzdGVuY2UgY2xlYXJzIHRoZSBjaGFuZ2Ugc2V0LlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHQgJiB7X3BlbmRpbmdVcGRhdGVBdWRpdENoYW5nZXM/OiBBdWRpdENoYW5nZXN9fSByZWNvcmQgLSBSZWNvcmQgd2hvc2UgcGVuZGluZyBjaGFuZ2VzIHNob3VsZCBiZSBjYXB0dXJlZC5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBjYXB0dXJlVXBkYXRlQXVkaXRDaGFuZ2VzKHJlY29yZCkge1xuICByZWNvcmQuX3BlbmRpbmdVcGRhdGVBdWRpdENoYW5nZXMgPSBhdWRpdENoYW5nZXNGb3JDdXJyZW50Q2hhbmdlcyhyZWNvcmQpXG59XG5cbi8qKlxuICogV3JpdGVzIHRoZSB1cGRhdGUgYXVkaXQgcm93IGZvciBhIG1vZGVsIGluc3RhbmNlLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHQgJiB7X3BlbmRpbmdVcGRhdGVBdWRpdENoYW5nZXM/OiBBdWRpdENoYW5nZXN9fSByZWNvcmQgLSBSZWNvcmQgdG8gYXVkaXQuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAqL1xuYXN5bmMgZnVuY3Rpb24gY3JlYXRlVXBkYXRlQXVkaXQocmVjb3JkKSB7XG4gIGNvbnN0IGF1ZGl0ZWRDaGFuZ2VzID0gcmVjb3JkLl9wZW5kaW5nVXBkYXRlQXVkaXRDaGFuZ2VzIHx8IG51bGxcblxuICByZWNvcmQuX3BlbmRpbmdVcGRhdGVBdWRpdENoYW5nZXMgPSB1bmRlZmluZWRcblxuICBpZiAoIWF1ZGl0ZWRDaGFuZ2VzIHx8IE9iamVjdC5rZXlzKGF1ZGl0ZWRDaGFuZ2VzKS5sZW5ndGggPD0gMCkgcmV0dXJuXG5cbiAgYXdhaXQgY3JlYXRlQXVkaXQocmVjb3JkLCB7XG4gICAgYWN0aW9uOiBcInVwZGF0ZVwiLFxuICAgIGF1ZGl0ZWRDaGFuZ2VzXG4gIH0pXG59XG5cbi8qKlxuICogV3JpdGVzIHRoZSBkZXN0cm95IGF1ZGl0IHJvdyBmb3IgYSBtb2RlbCBpbnN0YW5jZS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSByZWNvcmQgLSBSZWNvcmQgdG8gYXVkaXQuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAqL1xuYXN5bmMgZnVuY3Rpb24gY3JlYXRlRGVzdHJveUF1ZGl0KHJlY29yZCkge1xuICBhd2FpdCBjcmVhdGVBdWRpdChyZWNvcmQsIHtcbiAgICBhY3Rpb246IFwiZGVzdHJveVwiLFxuICAgIGF1ZGl0ZWRDaGFuZ2VzOiBhdWRpdENoYW5nZXNGb3JEZXN0cm95KHJlY29yZClcbiAgfSlcbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBDaGFuZ2VzIGhlbHBlcnNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIENhcHR1cmVzIHRoZSBuZXcgdmFsdWVzIGZvciBmaWVsZHMgY2hhbmdlZCBvbiBhIHJlY29yZC5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSByZWNvcmQgLSBSZWNvcmQgd2hvc2UgcGVuZGluZyBjaGFuZ2VzIHNob3VsZCBiZSBjYXB0dXJlZC5cbiAqIEByZXR1cm5zIHtBdWRpdENoYW5nZXN9IE5ldyB2YWx1ZXMga2V5ZWQgYnkgYXR0cmlidXRlIG5hbWUuXG4gKi9cbmZ1bmN0aW9uIGF1ZGl0Q2hhbmdlc0ZvckN1cnJlbnRDaGFuZ2VzKHJlY29yZCkge1xuICBjb25zdCBjaGFuZ2VzID0gcmVjb3JkLmNoYW5nZXMoKVxuICAvKiogQHR5cGUge0F1ZGl0Q2hhbmdlc30gKi9cbiAgY29uc3QgYXVkaXRlZENoYW5nZXMgPSB7fVxuICBjb25zdCBtb2RlbENsYXNzID0gLyoqIEB0eXBlIHtBdWRpdGVkTW9kZWxDbGFzcyAmIHtfYXVkaXRFeGNsdWRlZEF0dHJpYnV0ZXM/OiBTZXQ8c3RyaW5nPn19ICovIChyZWNvcmQuZ2V0TW9kZWxDbGFzcygpKVxuICBjb25zdCBjb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lID0gbW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKClcbiAgY29uc3QgZXhjbHVkZWRBdHRyaWJ1dGVzID0gbW9kZWxDbGFzcy5fYXVkaXRFeGNsdWRlZEF0dHJpYnV0ZXNcblxuICBmb3IgKGNvbnN0IFthdHRyaWJ1dGVOYW1lLCBjaGFuZ2VdIG9mIE9iamVjdC5lbnRyaWVzKGNoYW5nZXMpKSB7XG4gICAgY29uc3QgYXVkaXRlZEF0dHJpYnV0ZU5hbWUgPSBjb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lW2F0dHJpYnV0ZU5hbWVdIHx8IGF0dHJpYnV0ZU5hbWVcblxuICAgIGlmIChleGNsdWRlZEF0dHJpYnV0ZXMgJiYgKGV4Y2x1ZGVkQXR0cmlidXRlcy5oYXMoYXVkaXRlZEF0dHJpYnV0ZU5hbWUpIHx8IGV4Y2x1ZGVkQXR0cmlidXRlcy5oYXMoYXR0cmlidXRlTmFtZSkpKSB7XG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGF1ZGl0ZWRDaGFuZ2VzW2F1ZGl0ZWRBdHRyaWJ1dGVOYW1lXSA9IGNoYW5nZVsxXVxuICB9XG5cbiAgcmV0dXJuIGF1ZGl0ZWRDaGFuZ2VzXG59XG5cbi8qKlxuICogQ2FwdHVyZXMgdGhlIGN1cnJlbnQgYXR0cmlidXRlcyBmb3IgYSBkZXN0cm95IGF1ZGl0LlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IHJlY29yZCAtIFJlY29yZCBiZWluZyBkZXN0cm95ZWQuXG4gKiBAcmV0dXJucyB7QXVkaXRDaGFuZ2VzfSBDdXJyZW50IGF0dHJpYnV0ZXMga2V5ZWQgYnkgYXR0cmlidXRlIG5hbWUuXG4gKi9cbmZ1bmN0aW9uIGF1ZGl0Q2hhbmdlc0ZvckRlc3Ryb3kocmVjb3JkKSB7XG4gIHJldHVybiB7Li4ucmVjb3JkLmF0dHJpYnV0ZXMoKX1cbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyB3aXRob3V0QXVkaXRcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKipcbiAqIFJldHVybnMgcmVjb3JkcyB3aXRob3V0IGFuIGF1ZGl0IHJvdyBmb3IgdGhlIGdpdmVuIGFjdGlvbi5cbiAqIFVzZXMgc2hhcmVkLXRhYmxlIGRlZmF1bHRzIHdoZW4gdGFibGUgZGF0YSBpcyBub3QgeWV0IHJlc29sdmVkO1xuICogc3dpdGNoZXMgdG8gdGhlIGRlZGljYXRlZCB0YWJsZSBwYXRoIG9uY2UgcmVzb2x2ZWQuXG4gKiBAdGVtcGxhdGUge0F1ZGl0ZWRNb2RlbENsYXNzfSBNQ1xuICogQHBhcmFtIHtNQ30gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzIHRvIHNjb3BlLlxuICogQHBhcmFtIHtzdHJpbmd9IGFjdGlvbiAtIEF1ZGl0IGFjdGlvbiB0byBleGNsdWRlLlxuICogQHJldHVybnMge2ltcG9ydChcIi4uL3F1ZXJ5L21vZGVsLWNsYXNzLXF1ZXJ5LmpzXCIpLmRlZmF1bHQ8TUM+fSBRdWVyeSBzY29wZWQgdG8gcmVjb3JkcyB3aXRob3V0IHRoYXQgYXVkaXQgYWN0aW9uLlxuICovXG5mdW5jdGlvbiB3aXRob3V0QXVkaXQobW9kZWxDbGFzcywgYWN0aW9uKSB7XG4gIGNvbnN0IGRiID0gbW9kZWxDbGFzcy5jb25uZWN0aW9uKClcbiAgY29uc3QgZGF0YWJhc2VJZGVudGl0eSA9IGF1ZGl0RGF0YWJhc2VJZGVudGl0eShtb2RlbENsYXNzLCBkYilcbiAgY29uc3QgdGFibGVEYXRhID0gYXVkaXRUYWJsZURhdGFCeU1vZGVsLmdldChtb2RlbENsYXNzKT8uZ2V0KGRhdGFiYXNlSWRlbnRpdHkpXG4gIGNvbnN0IG1vZGVsVGFibGVTcWwgPSBkYi5xdW90ZVRhYmxlKG1vZGVsQ2xhc3MudGFibGVOYW1lKCkpXG4gIGNvbnN0IGF1ZGl0QWN0aW9uc1RhYmxlU3FsID0gZGIucXVvdGVUYWJsZShcImF1ZGl0X2FjdGlvbnNcIilcbiAgY29uc3QgcHJpbWFyeUtleSA9IHNjYWxhck1vZGVsUHJpbWFyeUtleShtb2RlbENsYXNzLnByaW1hcnlLZXkoKSwgYHdpdGhvdXRBdWRpdCBmb3IgJHttb2RlbENsYXNzLm5hbWV9YClcbiAgY29uc3QgbW9kZWxQcmltYXJ5S2V5U3FsID0gYCR7bW9kZWxUYWJsZVNxbH0uJHtkYi5xdW90ZUNvbHVtbihwcmltYXJ5S2V5KX1gXG4gIGNvbnN0IGF1ZGl0QWN0aW9uc0lkU3FsID0gYCR7YXVkaXRBY3Rpb25zVGFibGVTcWx9LiR7ZGIucXVvdGVDb2x1bW4oXCJpZFwiKX1gXG4gIGNvbnN0IGF1ZGl0QWN0aW9uc0FjdGlvblNxbCA9IGAke2F1ZGl0QWN0aW9uc1RhYmxlU3FsfS4ke2RiLnF1b3RlQ29sdW1uKFwiYWN0aW9uXCIpfWBcblxuICBpZiAodGFibGVEYXRhPy5kZWRpY2F0ZWQpIHtcbiAgICBjb25zdCBtb2RlbEtleSA9IG1vZGVsUGFyYW1LZXkobW9kZWxDbGFzcylcbiAgICBjb25zdCBhdWRpdHNUYWJsZVNxbCA9IGRiLnF1b3RlVGFibGUodGFibGVEYXRhLnRhYmxlTmFtZSlcbiAgICBjb25zdCBhdWRpdEFjdGlvbklkU3FsID0gYCR7YXVkaXRzVGFibGVTcWx9LiR7ZGIucXVvdGVDb2x1bW4oXCJhdWRpdF9hY3Rpb25faWRcIil9YFxuICAgIGNvbnN0IG1vZGVsSWRTcWwgPSBgJHthdWRpdHNUYWJsZVNxbH0uJHtkYi5xdW90ZUNvbHVtbihgJHttb2RlbEtleX1faWRgKX1gXG5cbiAgICByZXR1cm4gbW9kZWxDbGFzc1xuICAgICAgLmFsbCgpXG4gICAgICAud2hlcmUoYFxuICAgICAgICBOT1QgRVhJU1RTIChcbiAgICAgICAgICBTRUxFQ1QgMVxuICAgICAgICAgIEZST00gJHthdWRpdHNUYWJsZVNxbH1cbiAgICAgICAgICBJTk5FUiBKT0lOICR7YXVkaXRBY3Rpb25zVGFibGVTcWx9XG4gICAgICAgICAgICBPTiAke2F1ZGl0QWN0aW9uc0lkU3FsfSA9ICR7YXVkaXRBY3Rpb25JZFNxbH1cbiAgICAgICAgICBXSEVSRSAke21vZGVsSWRTcWx9ID0gJHttb2RlbFByaW1hcnlLZXlTcWx9XG4gICAgICAgICAgICBBTkQgJHthdWRpdEFjdGlvbnNBY3Rpb25TcWx9ID0gJHtkYi5xdW90ZShub3JtYWxpemVBY3Rpb24oYWN0aW9uKSl9XG4gICAgICAgIClcbiAgICAgIGApXG4gIH1cblxuICBjb25zdCBhdWRpdHNUYWJsZVNxbCA9IGRiLnF1b3RlVGFibGUoXCJhdWRpdHNcIilcbiAgY29uc3QgYXVkaXRBdWRpdGFibGVJZFNxbCA9IGAke2F1ZGl0c1RhYmxlU3FsfS4ke2RiLnF1b3RlQ29sdW1uKFwiYXVkaXRhYmxlX2lkXCIpfWBcbiAgY29uc3QgYXVkaXRBdWRpdGFibGVUeXBlU3FsID0gYCR7YXVkaXRzVGFibGVTcWx9LiR7ZGIucXVvdGVDb2x1bW4oXCJhdWRpdGFibGVfdHlwZVwiKX1gXG4gIGNvbnN0IGF1ZGl0QWN0aW9uSWRTcWwgPSBgJHthdWRpdHNUYWJsZVNxbH0uJHtkYi5xdW90ZUNvbHVtbihcImF1ZGl0X2FjdGlvbl9pZFwiKX1gXG5cbiAgcmV0dXJuIG1vZGVsQ2xhc3NcbiAgICAuYWxsKClcbiAgICAud2hlcmUoYFxuICAgICAgTk9UIEVYSVNUUyAoXG4gICAgICAgIFNFTEVDVCAxXG4gICAgICAgIEZST00gJHthdWRpdHNUYWJsZVNxbH1cbiAgICAgICAgSU5ORVIgSk9JTiAke2F1ZGl0QWN0aW9uc1RhYmxlU3FsfVxuICAgICAgICAgIE9OICR7YXVkaXRBY3Rpb25zSWRTcWx9ID0gJHthdWRpdEFjdGlvbklkU3FsfVxuICAgICAgICBXSEVSRSAke2F1ZGl0QXVkaXRhYmxlVHlwZVNxbH0gPSAke2RiLnF1b3RlKG1vZGVsQ2xhc3MuZ2V0TW9kZWxOYW1lKCkpfVxuICAgICAgICAgIEFORCAke2F1ZGl0QXVkaXRhYmxlSWRTcWx9ID0gJHttb2RlbFByaW1hcnlLZXlTcWx9XG4gICAgICAgICAgQU5EICR7YXVkaXRBY3Rpb25zQWN0aW9uU3FsfSA9ICR7ZGIucXVvdGUobm9ybWFsaXplQWN0aW9uKGFjdGlvbikpfVxuICAgICAgKVxuICAgIGApXG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gRXZlbnQgY2FsbGJhY2tzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBSZWdpc3RlcnMgYSBwZXItbW9kZWwgY2FsbGJhY2sgZmlyZWQgYWZ0ZXIgYW4gYXVkaXQgcm93IGlzIGNyZWF0ZWQuXG4gKiBAcGFyYW0ge0F1ZGl0ZWRNb2RlbENsYXNzfSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MgdG8gb2JzZXJ2ZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhY3Rpb24gLSBBdWRpdCBhY3Rpb24gbmFtZSAoZS5nLiBcImNyZWF0ZVwiKS5cbiAqIEBwYXJhbSB7QXVkaXRDYWxsYmFja30gY2FsbGJhY2sgLSBDYWxsYmFjayBpbnZva2VkIGFmdGVyIG1hdGNoaW5nIGF1ZGl0IHJvd3MgYXJlIGNyZWF0ZWQuXG4gKiBAcmV0dXJucyB7KCkgPT4gdm9pZH0gVW5zdWJzY3JpYmUgZnVuY3Rpb24uXG4gKi9cbmZ1bmN0aW9uIHJlZ2lzdGVyQXVkaXRDYWxsYmFjayhtb2RlbENsYXNzLCBhY3Rpb24sIGNhbGxiYWNrKSB7XG4gIGNvbnN0IG5vcm1hbGl6ZWRBY3Rpb24gPSBub3JtYWxpemVBY3Rpb24oYWN0aW9uKVxuICBjb25zdCBjYWxsYmFja3MgPSBhdWRpdENhbGxiYWNrc0Zvck1vZGVsQ2xhc3MobW9kZWxDbGFzcylcblxuICBpZiAoIWNhbGxiYWNrc1tub3JtYWxpemVkQWN0aW9uXSkge1xuICAgIGNhbGxiYWNrc1tub3JtYWxpemVkQWN0aW9uXSA9IFtdXG4gIH1cblxuICBjYWxsYmFja3Nbbm9ybWFsaXplZEFjdGlvbl0ucHVzaChjYWxsYmFjaylcblxuICByZXR1cm4gKCkgPT4ge1xuICAgIGNvbnN0IGFjdGlvbkNhbGxiYWNrcyA9IGNhbGxiYWNrc1tub3JtYWxpemVkQWN0aW9uXVxuICAgIGNvbnN0IGluZGV4ID0gYWN0aW9uQ2FsbGJhY2tzLmluZGV4T2YoY2FsbGJhY2spXG5cbiAgICBpZiAoaW5kZXggPj0gMCkge1xuICAgICAgYWN0aW9uQ2FsbGJhY2tzLnNwbGljZShpbmRleCwgMSlcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBFbWl0cyBwZXItbW9kZWwgYXVkaXQgY2FsbGJhY2tzIGZvciBhIG1vZGVsL2FjdGlvbiBwYWlyLlxuICogQHBhcmFtIHtBdWRpdGVkTW9kZWxDbGFzc30gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICogQHBhcmFtIHtzdHJpbmd9IGFjdGlvbiAtIEF1ZGl0IGFjdGlvbi5cbiAqIEBwYXJhbSB7QXVkaXRFdmVudFBheWxvYWR9IHBheWxvYWQgLSBFdmVudCBwYXlsb2FkLlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGVtaXRBdWRpdEV2ZW50KG1vZGVsQ2xhc3MsIGFjdGlvbiwgcGF5bG9hZCkge1xuICBjb25zdCBjYWxsYmFja3MgPSBhdWRpdENhbGxiYWNrc0Zvck1vZGVsQ2xhc3MobW9kZWxDbGFzcylbYWN0aW9uXSB8fCBbXVxuXG4gIGZvciAoY29uc3QgY2FsbGJhY2sgb2YgWy4uLmNhbGxiYWNrc10pIHtcbiAgICBhd2FpdCBjYWxsYmFjayhwYXlsb2FkKVxuICB9XG59XG5cbi8qKlxuICogUmV0dXJucyB0aGUgcGVyLW1vZGVsIGNhbGxiYWNrIG1hcC5cbiAqIEBwYXJhbSB7QXVkaXRlZE1vZGVsQ2xhc3N9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAqIEByZXR1cm5zIHtSZWNvcmQ8c3RyaW5nLCBBdWRpdENhbGxiYWNrW10+fSBDYWxsYmFjayBtYXAga2V5ZWQgYnkgYWN0aW9uLlxuICovXG5mdW5jdGlvbiBhdWRpdENhbGxiYWNrc0Zvck1vZGVsQ2xhc3MobW9kZWxDbGFzcykge1xuICBpZiAoIU9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChtb2RlbENsYXNzLCBcIl9hdWRpdENhbGxiYWNrc1wiKSkge1xuICAgIG1vZGVsQ2xhc3MuX2F1ZGl0Q2FsbGJhY2tzID0ge31cbiAgfVxuXG4gIGNvbnN0IGNhbGxiYWNrcyA9IG1vZGVsQ2xhc3MuX2F1ZGl0Q2FsbGJhY2tzXG5cbiAgaWYgKCFjYWxsYmFja3MpIHRocm93IG5ldyBFcnJvcihgQXVkaXQgY2FsbGJhY2tzIHdlcmVuJ3QgaW5pdGlhbGl6ZWQgZm9yICR7bW9kZWxDbGFzcy5nZXRNb2RlbE5hbWUoKX1gKVxuXG4gIHJldHVybiBjYWxsYmFja3Ncbn1cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBMb29rdXAgaGVscGVyc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKlxuICogRmluZHMgb3IgY3JlYXRlcyBhIGxvb2t1cCByb3cgYW5kIHJldHVybnMgaXRzIGlkLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbHVtbk5hbWUgLSBMb29rdXAgdmFsdWUgY29sdW1uIG5hbWUuXG4gKiBAcGFyYW0ge0RhdGV9IGFyZ3MuY3VycmVudERhdGUgLSBUaW1lc3RhbXAgdG8gd3JpdGUgd2hlbiBpbnNlcnRpbmcuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2RyaXZlcnMvYmFzZS5qc1wiKS5kZWZhdWx0fSBhcmdzLmRiIC0gRGF0YWJhc2UgZHJpdmVyLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MudGFibGVOYW1lIC0gTG9va3VwIHRhYmxlIG5hbWUuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy52YWx1ZSAtIExvb2t1cCB2YWx1ZS5cbiAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlciB8IHN0cmluZz59IExvb2t1cCByb3cgaWQuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGZpbmRPckNyZWF0ZUxvb2t1cElkKHtjb2x1bW5OYW1lLCBjdXJyZW50RGF0ZSwgZGIsIHRhYmxlTmFtZSwgdmFsdWV9KSB7XG4gIGF3YWl0IGRiLnVwc2VydCh7XG4gICAgdGFibGVOYW1lLFxuICAgIGNvbmZsaWN0Q29sdW1uczogW2NvbHVtbk5hbWVdLFxuICAgIHVwZGF0ZUNvbHVtbnM6IFtjb2x1bW5OYW1lXSxcbiAgICBkYXRhOiB7XG4gICAgICBpZDogbmV3IFVVSUQoNCkuZm9ybWF0KCksXG4gICAgICBbY29sdW1uTmFtZV06IHZhbHVlLFxuICAgICAgY3JlYXRlZF9hdDogY3VycmVudERhdGUsXG4gICAgICB1cGRhdGVkX2F0OiBjdXJyZW50RGF0ZVxuICAgIH1cbiAgfSlcblxuICBjb25zdCBpZCA9IGF3YWl0IGZpbmRMb29rdXBJZCh7Y29sdW1uTmFtZSwgZGIsIHRhYmxlTmFtZSwgdmFsdWV9KVxuXG4gIGlmIChpZCA9PT0gbnVsbCkgdGhyb3cgbmV3IEVycm9yKGBDb3VsZG4ndCBmaW5kICR7dGFibGVOYW1lfS4ke2NvbHVtbk5hbWV9IGFmdGVyIHVwc2VydGApXG5cbiAgcmV0dXJuIGlkXG59XG5cbi8qKlxuICogRmluZHMgYSBsb29rdXAgaWQgYnkgdmFsdWUuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY29sdW1uTmFtZSAtIExvb2t1cCB2YWx1ZSBjb2x1bW4gbmFtZS5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vZHJpdmVycy9iYXNlLmpzXCIpLmRlZmF1bHR9IGFyZ3MuZGIgLSBEYXRhYmFzZSBkcml2ZXIuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy50YWJsZU5hbWUgLSBMb29rdXAgdGFibGUgbmFtZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnZhbHVlIC0gTG9va3VwIHZhbHVlLlxuICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyIHwgc3RyaW5nIHwgbnVsbD59IExvb2t1cCByb3cgaWQgb3IgbnVsbC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gZmluZExvb2t1cElkKHtjb2x1bW5OYW1lLCBkYiwgdGFibGVOYW1lLCB2YWx1ZX0pIHtcbiAgY29uc3Qgcm93cyA9IC8qKiBAdHlwZSB7QXJyYXk8e2lkOiBudW1iZXIgfCBzdHJpbmd9Pn0gKi8gKGF3YWl0IGRiLnF1ZXJ5KGBcbiAgICBTRUxFQ1QgJHtkYi5xdW90ZUNvbHVtbihcImlkXCIpfSBBUyBpZFxuICAgIEZST00gJHtkYi5xdW90ZVRhYmxlKHRhYmxlTmFtZSl9XG4gICAgV0hFUkUgJHtkYi5xdW90ZUNvbHVtbihjb2x1bW5OYW1lKX0gPSAke2RiLnF1b3RlKHZhbHVlKX1cbiAgYCkpXG5cbiAgaWYgKHJvd3NbMF0pIHJldHVybiByb3dzWzBdLmlkXG5cbiAgcmV0dXJuIG51bGxcbn1cblxuLyoqXG4gKiBOb3JtYWxpemVzIGFuIGF1ZGl0IGFjdGlvbiBzdHJpbmcuXG4gKiBAcGFyYW0ge3N0cmluZ30gYWN0aW9uIC0gQWN0aW9uIG5hbWUuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSBUcmltbWVkLCBub24tZW1wdHkgYWN0aW9uIG5hbWUuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZUFjdGlvbihhY3Rpb24pIHtcbiAgY29uc3Qgbm9ybWFsaXplZEFjdGlvbiA9IGFjdGlvbi50cmltKClcblxuICBpZiAoIW5vcm1hbGl6ZWRBY3Rpb24pIHRocm93IG5ldyBFcnJvcihcIkF1ZGl0IGFjdGlvbiBtdXN0IGJlIHByZXNlbnRcIilcblxuICByZXR1cm4gbm9ybWFsaXplZEFjdGlvblxufVxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIE1pZ3JhdGlvbiBoZWxwZXJzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqXG4gKiBDcmVhdGVzIHRoZSBzaGFyZWQgYXVkaXQgdGFibGVzIG1pZ3JhdGlvbiB1cC9kb3duIGNhbGxiYWNrcyBmb3IgdXNlIGluc2lkZVxuICogYSBNaWdyYXRpb24gY2xhc3MuIFRoZSBgdGFibGVgIHBhcmFtZXRlciBpcyBhIE1pZ3JhdGlvbiBpbnN0YW5jZS5cbiAqIEBwYXJhbSB7e2lkPzoge3R5cGU6IHN0cmluZ319fSBbb3B0aW9uc10gLSBJRCBjb2x1bW4gb3B0aW9ucy5cbiAqIEByZXR1cm5zIHt7ZG93bjogKHRhYmxlOiBpbXBvcnQoXCIuLi9taWdyYXRpb24vaW5kZXguanNcIikuZGVmYXVsdCkgPT4gUHJvbWlzZTx2b2lkPiwgdXA6ICh0YWJsZTogaW1wb3J0KFwiLi4vbWlncmF0aW9uL2luZGV4LmpzXCIpLmRlZmF1bHQpID0+IFByb21pc2U8dm9pZD59fSAtIFVwL2Rvd24gY2FsbGJhY2tzIGZvciB0aGUgc2hhcmVkIGF1ZGl0IHRhYmxlcy5cbiAqL1xuZnVuY3Rpb24gY3JlYXRlU2hhcmVkQXVkaXRUYWJsZXNNaWdyYXRpb24ob3B0aW9ucyA9IHt9KSB7XG4gIGNvbnN0IG9wdHMgPSAvKiogQHR5cGUge3tpZD86IHt0eXBlOiBzdHJpbmd9fX0gKi8gKG9wdGlvbnMpXG4gIGNvbnN0IGlkT3B0aW9ucyA9IC8qKiBAdHlwZSB7e3R5cGU/OiBzdHJpbmd9fSAqLyAob3B0cy5pZCB8fCB7fSlcbiAgY29uc3QgdHlwZSA9IGlkT3B0aW9ucy50eXBlXG5cbiAgcmV0dXJuIHtcbiAgICBhc3luYyB1cCh0YWJsZSkge1xuICAgICAgYXdhaXQgdGFibGUuY3JlYXRlVGFibGUoXCJhdWRpdF9hY3Rpb25zXCIsIHtpZDogLyoqIEB0eXBlIHt7dHlwZT86IHN0cmluZ319ICovIChvcHRzLmlkIHx8IHt9KX0sICgvKiogQHR5cGUge3tzdHJpbmcobmFtZTogc3RyaW5nLCBvcHRpb25zOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IHZvaWQsIHRpbWVzdGFtcHMoKTogdm9pZH19ICovIHQpID0+IHtcbiAgICAgICAgdC5zdHJpbmcoXCJhY3Rpb25cIiwge2luZGV4OiB7dW5pcXVlOiB0cnVlfSwgbnVsbDogZmFsc2V9KVxuICAgICAgICB0LnRpbWVzdGFtcHMoKVxuICAgICAgfSlcblxuICAgICAgYXdhaXQgdGFibGUuY3JlYXRlVGFibGUoXCJhdWRpdF9hdWRpdGFibGVfdHlwZXNcIiwge2lkOiAvKiogQHR5cGUge3t0eXBlPzogc3RyaW5nfX0gKi8gKG9wdHMuaWQgfHwge30pfSwgKC8qKiBAdHlwZSB7e3N0cmluZyhuYW1lOiBzdHJpbmcsIG9wdGlvbnM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogdm9pZCwgdGltZXN0YW1wcygpOiB2b2lkfX0gKi8gdCkgPT4ge1xuICAgICAgICB0LnN0cmluZyhcIm5hbWVcIiwge2luZGV4OiB7dW5pcXVlOiB0cnVlfSwgbnVsbDogZmFsc2V9KVxuICAgICAgICB0LnRpbWVzdGFtcHMoKVxuICAgICAgfSlcblxuICAgICAgYXdhaXQgdGFibGUuY3JlYXRlVGFibGUoXCJhdWRpdHNcIiwge2lkOiAvKiogQHR5cGUge3t0eXBlPzogc3RyaW5nfX0gKi8gKG9wdHMuaWQgfHwge30pfSwgKC8qKiBAdHlwZSB7e2pzb24obmFtZTogc3RyaW5nKTogdm9pZCwgcmVmZXJlbmNlcyhuYW1lOiBzdHJpbmcsIG9wdGlvbnM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogdm9pZCwgdGltZXN0YW1wcygpOiB2b2lkfX0gKi8gdCkgPT4ge1xuICAgICAgICB0LnJlZmVyZW5jZXMoXCJhdWRpdF9hY3Rpb25cIiwge2ZvcmVpZ25LZXk6IHRydWUsIG51bGw6IGZhbHNlLCB0eXBlfSlcbiAgICAgICAgdC5yZWZlcmVuY2VzKFwiYXVkaXRfYXVkaXRhYmxlX3R5cGVcIiwge2ZvcmVpZ25LZXk6IHRydWUsIG51bGw6IGZhbHNlLCB0eXBlfSlcbiAgICAgICAgdC5yZWZlcmVuY2VzKFwiYXVkaXRhYmxlXCIsIHtudWxsOiBmYWxzZSwgcG9seW1vcnBoaWM6IHRydWUsIHR5cGV9KVxuICAgICAgICB0Lmpzb24oXCJhdWRpdGVkX2NoYW5nZXNcIilcbiAgICAgICAgdC5qc29uKFwicGFyYW1zXCIpXG4gICAgICAgIHQudGltZXN0YW1wcygpXG4gICAgICB9KVxuICAgIH0sXG5cbiAgICBhc3luYyBkb3duKHRhYmxlKSB7XG4gICAgICBhd2FpdCB0YWJsZS5kcm9wVGFibGUoXCJhdWRpdHNcIilcbiAgICAgIGF3YWl0IHRhYmxlLmRyb3BUYWJsZShcImF1ZGl0X2F1ZGl0YWJsZV90eXBlc1wiKVxuICAgICAgYXdhaXQgdGFibGUuZHJvcFRhYmxlKFwiYXVkaXRfYWN0aW9uc1wiKVxuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIFJldHVybnMgdGhlIGRlZGljYXRlZCBhdWRpdCB0YWJsZSBuYW1lIGZvciBhIGdpdmVuIG1vZGVsIHRhYmxlIG5hbWUuXG4gKiBAcGFyYW0ge3N0cmluZ30gbW9kZWxUYWJsZU5hbWUgLSBNb2RlbCB0YWJsZSBuYW1lIChlLmcuIFwicHJvamVjdHNcIikuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSBEZWRpY2F0ZWQgYXVkaXQgdGFibGUgbmFtZSAoZS5nLiBcInByb2plY3RfYXVkaXRzXCIpLlxuICovXG5mdW5jdGlvbiBkZWRpY2F0ZWRBdWRpdFRhYmxlTmFtZUZvclRhYmxlKG1vZGVsVGFibGVOYW1lKSB7XG4gIGlmIChtb2RlbFRhYmxlTmFtZS5lbmRzV2l0aChcInNcIikpIHtcbiAgICByZXR1cm4gYCR7bW9kZWxUYWJsZU5hbWUuc2xpY2UoMCwgLTEpfV9hdWRpdHNgXG4gIH1cblxuICByZXR1cm4gYCR7bW9kZWxUYWJsZU5hbWV9X2F1ZGl0c2Bcbn1cblxuZXhwb3J0IHtcbiAgQXVkaXRFdmVudHMsXG4gIGNhcHR1cmVDcmVhdGVBdWRpdENoYW5nZXMsXG4gIGNhcHR1cmVVcGRhdGVBdWRpdENoYW5nZXMsXG4gIGNyZWF0ZUF1ZGl0LFxuICBjcmVhdGVDcmVhdGVBdWRpdCxcbiAgY3JlYXRlRGVzdHJveUF1ZGl0LFxuICBjcmVhdGVVcGRhdGVBdWRpdCxcbiAgY3JlYXRlU2hhcmVkQXVkaXRUYWJsZXNNaWdyYXRpb24sXG4gIGRlZGljYXRlZEF1ZGl0VGFibGVOYW1lRm9yVGFibGUsXG4gIGluaXRpYWxpemVBdWRpdGVkTW9kZWxSZWxhdGlvbnNoaXBzLFxuICBpbml0aWFsaXplQXVkaXRpbmcsXG4gIHJlZ2lzdGVyQXVkaXRDYWxsYmFjayxcbiAgcmVnaXN0ZXJBdWRpdGluZyxcbiAgd2l0aG91dEF1ZGl0XG59XG4iXX0=