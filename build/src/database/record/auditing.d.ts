export type AuditEventsType = {
    /**
     * - Fire all callbacks for a model type + action.
     */
    call: (type: string, action: string, args: AuditEventPayload) => void;
    /**
     * - Register a callback for a model type + action. Returns an unsubscribe function.
     */
    connect: (type: string, action: string, callback: (args: AuditEventPayload) => void) => () => void;
    /**
     * - Clear all registered callbacks.
     */
    reset: () => void;
};
export type AuditChanges = Record<string, ReturnType<typeof JSON.parse>>;
export type AuditEventPayload = {
    /**
     * - Audit action name.
     */
    action: string;
    /**
     * - Created audit row id.
     */
    auditId: number | string;
    /**
     * - Changes captured for the audit.
     */
    auditedChanges: AuditChanges | null;
    /**
     * - Optional caller-supplied audit params.
     */
    params: Record<string, ReturnType<typeof JSON.parse>> | null;
    /**
     * - Audited record.
     */
    record: import("./index.js").default;
};
export type AuditCallback = (payload: AuditEventPayload) => void | Promise<void>;
export type CreateAuditArgs = {
    /**
     * - Audit action name.
     */
    action: string;
    /**
     * - Explicit changes to persist.
     */
    auditedChanges?: AuditChanges | null;
    /**
     * - Optional metadata to store with the audit.
     */
    params?: Record<string, ReturnType<typeof JSON.parse>> | null;
};
export type AuditedModelClass = typeof import("./index.js").default & {
    _auditCallbacks?: Record<string, AuditCallback[]>;
    _auditLifecycleCallbacksRegistered?: boolean;
    _auditTableResolved?: boolean;
    _auditTableData?: AuditTableData;
};
export type AuditTableData = {
    /**
     * - Whether a dedicated audit table exists.
     */
    dedicated: boolean;
    /**
     * - Name of the audit table.
     */
    tableName: string;
    /**
     * - Column name that references the audited model.
     */
    foreignKey: string;
    /**
     * - The audit model class to use.
     */
    auditClass: typeof import("./index.js").default;
};
/** @type {AuditEventsType} */
declare const AuditEvents: AuditEventsType;
/**
 * Registers lifecycle callbacks for automatic create/update/destroy auditing.
 * Table detection and relationship registration happen lazily on first usage.
 * Called synchronously from Model.audited() at module-load time.
 * @param {AuditedModelClass} modelClass - Model class to audit.
 * @returns {void}
 */
declare function registerAuditing(modelClass: AuditedModelClass): void;
/**
 * Initializes audit metadata for audited model classes.
 * @param {typeof import("./index.js").default} modelClass - Model class to initialize.
 * @param {{resolveTableData?: boolean}} [args] - Initialization options.
 * @returns {Promise<void>}
 */
declare function initializeAuditing(modelClass: typeof import("./index.js").default, args?: {
    resolveTableData?: boolean;
}): Promise<void>;
/**
 * Resolves audit metadata after application and package model classes are registered.
 * @param {import("../../configuration.js").default} configuration - Configuration whose models should be finalized.
 * @returns {Promise<void>}
 */
declare function initializeAuditedModelRelationships(configuration: import("../../configuration.js").default): Promise<void>;
/**
 * Creates an audit row for a record.
 * @param {import("./index.js").default} record - Record to audit.
 * @param {CreateAuditArgs} args - Audit row options (action, auditedChanges, params).
 * @returns {Promise<number | string>} Created audit row id.
 */
declare function createAudit(record: import("./index.js").default, args: CreateAuditArgs): Promise<number | string>;
/**
 * Captures create changes before persistence clears the change set.
 * @param {import("./index.js").default & {_pendingCreateAuditChanges?: AuditChanges}} record - Record whose pending changes should be captured.
 * @returns {void}
 */
declare function captureCreateAuditChanges(record: import("./index.js").default & {
    _pendingCreateAuditChanges?: AuditChanges;
}): void;
/**
 * Writes the create audit row for a model instance.
 * @param {import("./index.js").default & {_pendingCreateAuditChanges?: AuditChanges}} record - Record to audit.
 * @returns {Promise<void>}
 */
declare function createCreateAudit(record: import("./index.js").default & {
    _pendingCreateAuditChanges?: AuditChanges;
}): Promise<void>;
/**
 * Captures update changes before persistence clears the change set.
 * @param {import("./index.js").default & {_pendingUpdateAuditChanges?: AuditChanges}} record - Record whose pending changes should be captured.
 * @returns {void}
 */
declare function captureUpdateAuditChanges(record: import("./index.js").default & {
    _pendingUpdateAuditChanges?: AuditChanges;
}): void;
/**
 * Writes the update audit row for a model instance.
 * @param {import("./index.js").default & {_pendingUpdateAuditChanges?: AuditChanges}} record - Record to audit.
 * @returns {Promise<void>}
 */
declare function createUpdateAudit(record: import("./index.js").default & {
    _pendingUpdateAuditChanges?: AuditChanges;
}): Promise<void>;
/**
 * Writes the destroy audit row for a model instance.
 * @param {import("./index.js").default} record - Record to audit.
 * @returns {Promise<void>}
 */
declare function createDestroyAudit(record: import("./index.js").default): Promise<void>;
/**
 * Returns records without an audit row for the given action.
 * Uses shared-table defaults when table data is not yet resolved;
 * switches to the dedicated table path once resolved.
 * @template {AuditedModelClass} MC
 * @param {MC} modelClass - Model class to scope.
 * @param {string} action - Audit action to exclude.
 * @returns {import("../query/model-class-query.js").default<MC>} Query scoped to records without that audit action.
 */
declare function withoutAudit<MC extends AuditedModelClass>(modelClass: MC, action: string): import("../query/model-class-query.js").default<MC>;
/**
 * Registers a per-model callback fired after an audit row is created.
 * @param {AuditedModelClass} modelClass - Model class to observe.
 * @param {string} action - Audit action name (e.g. "create").
 * @param {AuditCallback} callback - Callback invoked after matching audit rows are created.
 * @returns {() => void} Unsubscribe function.
 */
declare function registerAuditCallback(modelClass: AuditedModelClass, action: string, callback: AuditCallback): () => void;
/**
 * Creates the shared audit tables migration up/down callbacks for use inside
 * a Migration class. The `table` parameter is a Migration instance.
 * @param {{id?: {type: string}}} [options] - ID column options.
 * @returns {{down: (table: import("../migration/index.js").default) => Promise<void>, up: (table: import("../migration/index.js").default) => Promise<void>}} - Up/down callbacks for the shared audit tables.
 */
declare function createSharedAuditTablesMigration(options?: {
    id?: {
        type: string;
    };
}): {
    down: (table: import("../migration/index.js").default) => Promise<void>;
    up: (table: import("../migration/index.js").default) => Promise<void>;
};
/**
 * Returns the dedicated audit table name for a given model table name.
 * @param {string} modelTableName - Model table name (e.g. "projects").
 * @returns {string} Dedicated audit table name (e.g. "project_audits").
 */
declare function dedicatedAuditTableNameForTable(modelTableName: string): string;
export { AuditEvents, captureCreateAuditChanges, captureUpdateAuditChanges, createAudit, createCreateAudit, createDestroyAudit, createUpdateAudit, createSharedAuditTablesMigration, dedicatedAuditTableNameForTable, initializeAuditedModelRelationships, initializeAuditing, registerAuditCallback, registerAuditing, withoutAudit };
//# sourceMappingURL=auditing.d.ts.map