// @ts-check

import UUID from "pure-uuid"

/**
 * AuditChanges type.
 * @typedef {Record<string, ?>} AuditChanges
 */

/**
 * AuditEventPayload type.
 * @typedef {object} AuditEventPayload
 * @property {string} action - Audit action name.
 * @property {number | string} auditId - Created audit row id.
 * @property {AuditChanges | null} auditedChanges - Changes captured for the audit.
 * @property {Record<string, ?> | null} params - Optional caller-supplied audit params.
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
 * @property {Record<string, ?> | null} [params] - Optional metadata to store with the audit.
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

/** @type {Map<string, boolean>} */
const dedicatedTableCache = new Map()

/** @type {Map<string, typeof import("./index.js").default>} */
const auditClassCache = new Map()

const generatedAuditRelationships = new WeakSet()

// ---------------------------------------------------------------------------
// Global event bus (like ActiveRecordAuditable::Events)
// ---------------------------------------------------------------------------

/** @type {Record<string, Record<string, Array<(args: AuditEventPayload) => void>>>} */
let globalEventConnections = {}

/**
 * Global audit event bus matching ActiveRecordAuditable::Events.
 * @typedef {object} AuditEventsType
 * @property {(type: string, action: string, args: AuditEventPayload) => void} call - Fire all callbacks for a model type + action.
 * @property {(type: string, action: string, callback: (args: AuditEventPayload) => void) => () => void} connect - Register a callback for a model type + action. Returns an unsubscribe function.
 * @property {() => void} reset - Clear all registered callbacks.
 */

/** @type {AuditEventsType} */
const AuditEvents = {
  /**
   * Fire all registered callbacks for a model type and action.
   * @param {string} type - Model type.
   * @param {string} action - Audit action name.
   * @param {AuditEventPayload} args - Audit event payload.
   */
  call(type, action, args) {
    const actions = globalEventConnections[type] || {}
    const callbacks = actions[action] || []

    for (const callback of [...callbacks]) {
      callback(args)
    }
  },

  /**
   * Register a callback for a model type and action.
   * @param {string} type - Model type.
   * @param {string} action - Audit action name.
   * @param {(args: AuditEventPayload) => void} callback - Callback to register.
   * @returns {() => void} - Callback that removes the registration.
   */
  connect(type, action, callback) {
    if (!globalEventConnections[type]) {
      globalEventConnections[type] = {}
    }

    if (!globalEventConnections[type][action]) {
      globalEventConnections[type][action] = []
    }

    globalEventConnections[type][action].push(callback)

    return () => {
      const list = globalEventConnections[type]?.[action]

      if (list) {
        const index = list.indexOf(callback)

        if (index >= 0) {
          list.splice(index, 1)
        }
      }
    }
  },

  /** Clear all registered callbacks. */
  reset() {
    globalEventConnections = {}
  }
}

// ---------------------------------------------------------------------------
// Table detection
// ---------------------------------------------------------------------------

/**
 * Returns the dedicated audit table name for a model class.
 * @param {AuditedModelClass} modelClass - Audited model class.
 * @returns {string} e.g. "project_audits" for a "projects" table.
 */
function dedicatedAuditTableName(modelClass) {
  const table = modelClass.tableName()

  if (table.endsWith("s")) {
    return `${table.slice(0, -1)}_audits`
  }

  return `${table}_audits`
}

/**
 * Resolves audit table data for a model class. Cached per model.
 * Called lazily on first createAudit / withoutAudit / relationship usage.
 * @param {AuditedModelClass} modelClass - Audited model class.
 * @returns {Promise<AuditTableData>} Resolved audit table metadata.
 */
async function resolveAuditTableData(modelClass) {
  if (modelClass._auditTableResolved && modelClass._auditTableData) {
    return modelClass._auditTableData
  }

  const tableData = await buildAuditTableData(modelClass)
  const configuration = modelClass._getConfiguration()

  tableData.auditClass.registerRecordClass({configuration})
  await tableData.auditClass.initializeRecord({configuration})

  modelClass._auditTableData = tableData
  modelClass._auditTableResolved = true

  registerAuditRelationship(modelClass, tableData)

  return tableData
}

/**
 * Builds audit table metadata for a model class. Prefers the consumer's
 * registered Audit model for shared tables; falls back to a framework-owned
 * dynamic class.
 * @param {AuditedModelClass} modelClass - Audited model class.
 * @returns {Promise<AuditTableData>} Audit table metadata.
 */
async function buildAuditTableData(modelClass) {
  const dedicatedTable = dedicatedAuditTableName(modelClass)
  const dedicatedExists = await dedicatedTableExistsForConnection(modelClass, dedicatedTable)

  if (dedicatedExists) {
    const auditClass = dedicatedAuditClass(modelClass, dedicatedTable)
    const modelKey = modelParamKey(modelClass)

    return {
      auditClass,
      dedicated: true,
      foreignKey: `${modelKey}_id`,
      tableName: dedicatedTable
    }
  }

  const configuration = modelClass._getConfiguration()

  const consumerAuditClass = configuration.getModelClasses().Audit

  if (consumerAuditClass) {
    return {
      auditClass: consumerAuditClass,
      dedicated: false,
      foreignKey: "auditable_id",
      tableName: "audits"
    }
  }

  return {
    auditClass: cachedSharedAuditClass(modelClass),
    dedicated: false,
    foreignKey: "auditable_id",
    tableName: "audits"
  }
}

/**
 * Checks whether a dedicated audit table exists for a model's connection.
 * @param {AuditedModelClass} modelClass - Audited model class.
 * @param {string} tableName - Dedicated audit table name to check.
 * @returns {Promise<boolean>} Whether the table exists.
 */
async function dedicatedTableExistsForConnection(modelClass, tableName) {
  const databaseIdentifier = modelClass.getDatabaseIdentifier()
  const cacheKey = `${databaseIdentifier}:${tableName}`
  const cached = dedicatedTableCache.get(cacheKey)

  if (typeof cached === "boolean") {
    return cached
  }

  const connection = modelClass.connection()
  const table = await connection.getTableByName(tableName, {throwError: false})
  const exists = Boolean(table)

  dedicatedTableCache.set(cacheKey, exists)

  return exists
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
  const dbRecordClass = findDatabaseRecordClass(modelClass)

  /**
   * Framework-owned Audit model for the shared `audits` table.
   */
  class Audit extends dbRecordClass {
    /**
     * Returns the backing table name.
     * @returns {string} - The backing table name.
     */
    static tableName() {
      return "audits"
    }
  }

  Object.defineProperty(Audit, "modelName", {value: "Audit", writable: false})
  applyAuditClassDatabaseRouting(modelClass, Audit)

  return /** @type {typeof import("./index.js").default} */ (Audit)
}

/**
 * Returns the cached framework-owned shared Audit class for a database.
 * @param {AuditedModelClass} modelClass - Any audited model class.
 * @returns {typeof import("./index.js").default} Shared Audit model class.
 */
function cachedSharedAuditClass(modelClass) {
  const routingKey = modelClass.hasTenantDatabaseIdentifierResolver()
    ? `tenant:${modelClass.getModelName()}`
    : `database:${modelClass.getConfiguredDatabaseIdentifier()}`
  const cacheKey = `shared:${routingKey}`
  let auditClass = auditClassCache.get(cacheKey)

  if (!auditClass) {
    auditClass = sharedAuditClass(modelClass)
    auditClassCache.set(cacheKey, auditClass)
  }

  return auditClass
}

/**
 * Returns a dynamic per-model audit class for a dedicated table.
 * @param {AuditedModelClass} modelClass - Audited model class.
 * @param {string} tableName - Dedicated audit table name (e.g. "project_audits").
 * @returns {typeof import("./index.js").default} Dedicated audit model class.
 */
function dedicatedAuditClass(modelClass, tableName) {
  const dbRecordClass = findDatabaseRecordClass(modelClass)
  const modelName = modelClass.getModelName()
  const modelKey = modelParamKey(modelClass)

  /**
   * Framework-owned per-model Audit class.
   */
  class ModelAudit extends dbRecordClass {
    /**
     * Returns the backing table name.
     * @returns {string} - The backing table name.
     */
    static tableName() {
      return tableName
    }
  }

  Object.defineProperty(ModelAudit, "modelName", {value: `${modelName}Audit`, writable: false})
  applyAuditClassDatabaseRouting(modelClass, ModelAudit)
  ModelAudit.belongsTo(modelKey, {className: modelName})

  return /** @type {typeof import("./index.js").default} */ (ModelAudit)
}

/**
 * Makes framework-owned audit classes read the same database as the audited model.
 * @param {AuditedModelClass} modelClass - Audited source model class.
 * @param {typeof import("./index.js").default} auditClass - Generated audit class.
 * @returns {void}
 */
function applyAuditClassDatabaseRouting(modelClass, auditClass) {
  auditClass.setDatabaseIdentifier(modelClass.getConfiguredDatabaseIdentifier())

  if (modelClass.hasTenantDatabaseIdentifierResolver()) {
    auditClass.switchesTenantDatabase(({tenant}) => modelClass.getTenantDatabaseIdentifier(tenant))
  }
}

/**
 * Walks the prototype chain to find the root DatabaseRecord class.
 * @param {AuditedModelClass} modelClass - Audited model class.
 * @returns {typeof import("./index.js").default} Root DatabaseRecord class.
 */
function findDatabaseRecordClass(modelClass) {
  let recordClass = Object.getPrototypeOf(modelClass)

  while (recordClass && Object.getPrototypeOf(recordClass) !== Function.prototype) {
    recordClass = Object.getPrototypeOf(recordClass)
  }

  return /** @type {typeof import("./index.js").default} */ (recordClass)
}

/**
 * Returns the parameter-key name for a model class.
 * @param {AuditedModelClass} modelClass - Audited model class.
 * @returns {string} e.g. "project" for "Project".
 */
function modelParamKey(modelClass) {
  const name = modelClass.getModelName()

  return name.charAt(0).toLowerCase() + name.slice(1)
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
    return
  }

  modelClass._auditLifecycleCallbacksRegistered = true
  registerAuditRelationship(modelClass)
  modelClass.beforeCreate("captureCreateAuditChanges")
  modelClass.afterCreate("createCreateAudit")
  modelClass.beforeUpdate("captureUpdateAuditChanges")
  modelClass.afterUpdate("createUpdateAudit")
  modelClass.afterDestroy("createDestroyAudit")
}

/**
 * Initializes audit metadata for audited model classes.
 * @param {typeof import("./index.js").default} modelClass - Model class to initialize.
 * @param {{resolveTableData?: boolean}} [args] - Initialization options.
 * @returns {Promise<void>}
 */
async function initializeAuditing(modelClass, args = {}) {
  const {resolveTableData = false} = args
  const auditedModelClass = /** @type {AuditedModelClass} */ (modelClass)

  if (!auditedModelClass._auditLifecycleCallbacksRegistered) {
    return
  }

  registerAuditRelationship(auditedModelClass)

  if (resolveTableData && shouldResolveAuditTableData(auditedModelClass)) {
    await resolveAuditTableData(auditedModelClass)
  }
}

/**
 * Resolves audit metadata after application and package model classes are registered.
 * @param {import("../../configuration.js").default} configuration - Configuration whose models should be finalized.
 * @returns {Promise<void>}
 */
async function initializeAuditedModelRelationships(configuration) {
  const modelClasses = Object.values(configuration.getModelClasses())
  const shouldResolveTableData = modelClasses.some((modelClass) => shouldResolveAuditTableData(modelClass))

  if (!shouldResolveTableData) {
    for (const modelClass of modelClasses) {
      await initializeAuditing(modelClass)
    }

    return
  }

  await configuration.ensureConnections({name: "Initialize audited model relationships"}, async () => {
    for (const modelClass of modelClasses) {
      await initializeAuditing(modelClass, {resolveTableData: true})
    }
  })
}

/**
 * Checks whether audit table metadata should be resolved for a model class.
 * @param {typeof import("./index.js").default} modelClass - Model class to inspect.
 * @returns {boolean} Whether table metadata resolution should run now.
 */
function shouldResolveAuditTableData(modelClass) {
  const auditedModelClass = /** @type {AuditedModelClass} */ (modelClass)

  if (!auditedModelClass._auditLifecycleCallbacksRegistered) {
    return false
  }

  return Boolean(auditedModelClass._initialized) && canResolveAuditTableData(auditedModelClass)
}

/**
 * Registers the audits relationship without forcing audit table detection.
 * @param {AuditedModelClass} modelClass - Model class to audit.
 * @param {AuditTableData} [tableData] - Resolved audit table data when available.
 * @returns {void}
 */
function registerAuditRelationship(modelClass, tableData = defaultAuditRelationshipTableData(modelClass)) {
  if (modelClass._relationshipExists("audits")) {
    const relationship = modelClass.getRelationshipByName("audits")

    if (generatedAuditRelationships.has(relationship)) {
      relationship.className = undefined
      relationship.klass = tableData.auditClass
      relationship.foreignKey = tableData.foreignKey
      relationship._explicitForeignKey = tableData.foreignKey
      relationship._polymorphic = !tableData.dedicated
      relationship._polymorphicTypeColumn = undefined
    }

    return
  }

  modelClass.hasMany("audits", auditRelationshipScope, {
    foreignKey: tableData.foreignKey,
    klass: tableData.auditClass,
    polymorphic: !tableData.dedicated
  })
  generatedAuditRelationships.add(modelClass.getRelationshipByName("audits"))
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
  }
}

/**
 * Applies default audit ordering to generated audit relationships.
 * @param {import("../query/model-class-query.js").default<typeof import("./index.js").default>} query - Audit query.
 * @returns {import("../query/model-class-query.js").default<typeof import("./index.js").default>} Ordered audit query.
 */
function auditRelationshipScope(query) {
  return query.order({column: "created_at", direction: "DESC"})
}

/**
 * Checks whether the current tenant context can resolve audit table data.
 * @param {AuditedModelClass} modelClass - Model class to inspect.
 * @returns {boolean} Whether audit table data can be resolved in the current scope.
 */
function canResolveAuditTableData(modelClass) {
  if (!modelClass.hasTenantDatabaseIdentifierResolver()) {
    return true
  }

  const tenantDatabaseIdentifier = modelClass.getTenantDatabaseIdentifier()

  if (!tenantDatabaseIdentifier) {
    return false
  }

  return modelClass._getConfiguration().isDatabaseIdentifierActive(tenantDatabaseIdentifier)
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
  const modelClass = /** @type {AuditedModelClass} */ (record.getModelClass())

  return await modelClass._getConfiguration().ensureConnections({name: `${modelClass.getModelName()} audit`}, async () => {
    return await createAuditWithCurrentConnection(record, args, modelClass)
  })
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
  if (!record.isPersisted()) throw new Error(`Cannot audit unpersisted ${modelClass.getModelName()} record`)

  const tableData = await resolveAuditTableData(modelClass)
  const action = normalizeAction(args.action)
  const auditedChanges = args.auditedChanges === undefined ? null : args.auditedChanges
  const params = args.params === undefined ? null : args.params
  const db = modelClass.connection()
  const currentDate = new Date()

  const auditActionId = await findOrCreateLookupId({
    columnName: "action",
    currentDate,
    db,
    tableName: "audit_actions",
    value: action
  })

  const auditId = new UUID(4).format()

  if (tableData.dedicated) {
    const modelKey = modelParamKey(modelClass)

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
    }))
  } else {
    const auditAuditableTypeId = await findOrCreateLookupId({
      columnName: "name",
      currentDate,
      db,
      tableName: "audit_auditable_types",
      value: modelClass.getModelName()
    })

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
    }))
  }

  await emitAuditEvent(modelClass, action, {
    action,
    auditId,
    auditedChanges,
    params,
    record
  })

  AuditEvents.call(modelClass.getModelName(), action, {
    action,
    auditId,
    auditedChanges,
    params,
    record
  })

  return auditId
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
  record._pendingCreateAuditChanges = auditChangesForCurrentChanges(record)
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
  })

  record._pendingCreateAuditChanges = undefined
}

/**
 * Captures update changes before persistence clears the change set.
 * @param {import("./index.js").default & {_pendingUpdateAuditChanges?: AuditChanges}} record - Record whose pending changes should be captured.
 * @returns {void}
 */
function captureUpdateAuditChanges(record) {
  record._pendingUpdateAuditChanges = auditChangesForCurrentChanges(record)
}

/**
 * Writes the update audit row for a model instance.
 * @param {import("./index.js").default & {_pendingUpdateAuditChanges?: AuditChanges}} record - Record to audit.
 * @returns {Promise<void>}
 */
async function createUpdateAudit(record) {
  const auditedChanges = record._pendingUpdateAuditChanges || null

  record._pendingUpdateAuditChanges = undefined

  if (!auditedChanges || Object.keys(auditedChanges).length <= 0) return

  await createAudit(record, {
    action: "update",
    auditedChanges
  })
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
  })
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
  const changes = record.changes()
  /** @type {AuditChanges} */
  const auditedChanges = {}
  const columnNameToAttributeName = record.getModelClass().getColumnNameToAttributeNameMap()

  for (const [attributeName, change] of Object.entries(changes)) {
    auditedChanges[columnNameToAttributeName[attributeName] || attributeName] = change[1]
  }

  return auditedChanges
}

/**
 * Captures the current attributes for a destroy audit.
 * @param {import("./index.js").default} record - Record being destroyed.
 * @returns {AuditChanges} Current attributes keyed by attribute name.
 */
function auditChangesForDestroy(record) {
  return {...record.attributes()}
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
  const db = modelClass.connection()
  const modelTableSql = db.quoteTable(modelClass.tableName())
  const auditActionsTableSql = db.quoteTable("audit_actions")
  const modelPrimaryKeySql = `${modelTableSql}.${db.quoteColumn(modelClass.primaryKey())}`
  const auditActionsIdSql = `${auditActionsTableSql}.${db.quoteColumn("id")}`
  const auditActionsActionSql = `${auditActionsTableSql}.${db.quoteColumn("action")}`

  if (modelClass._auditTableResolved && modelClass._auditTableData?.dedicated) {
    const tableData = modelClass._auditTableData
    const modelKey = modelParamKey(modelClass)
    const auditsTableSql = db.quoteTable(tableData.tableName)
    const auditActionIdSql = `${auditsTableSql}.${db.quoteColumn("audit_action_id")}`
    const modelIdSql = `${auditsTableSql}.${db.quoteColumn(`${modelKey}_id`)}`

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
      `)
  }

  const auditsTableSql = db.quoteTable("audits")
  const auditAuditableIdSql = `${auditsTableSql}.${db.quoteColumn("auditable_id")}`
  const auditAuditableTypeSql = `${auditsTableSql}.${db.quoteColumn("auditable_type")}`
  const auditActionIdSql = `${auditsTableSql}.${db.quoteColumn("audit_action_id")}`

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
    `)
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
  const normalizedAction = normalizeAction(action)
  const callbacks = auditCallbacksForModelClass(modelClass)

  if (!callbacks[normalizedAction]) {
    callbacks[normalizedAction] = []
  }

  callbacks[normalizedAction].push(callback)

  return () => {
    const actionCallbacks = callbacks[normalizedAction]
    const index = actionCallbacks.indexOf(callback)

    if (index >= 0) {
      actionCallbacks.splice(index, 1)
    }
  }
}

/**
 * Emits per-model audit callbacks for a model/action pair.
 * @param {AuditedModelClass} modelClass - Model class.
 * @param {string} action - Audit action.
 * @param {AuditEventPayload} payload - Event payload.
 * @returns {Promise<void>}
 */
async function emitAuditEvent(modelClass, action, payload) {
  const callbacks = auditCallbacksForModelClass(modelClass)[action] || []

  for (const callback of [...callbacks]) {
    await callback(payload)
  }
}

/**
 * Returns the per-model callback map.
 * @param {AuditedModelClass} modelClass - Model class.
 * @returns {Record<string, AuditCallback[]>} Callback map keyed by action.
 */
function auditCallbacksForModelClass(modelClass) {
  if (!Object.prototype.hasOwnProperty.call(modelClass, "_auditCallbacks")) {
    modelClass._auditCallbacks = {}
  }

  const callbacks = modelClass._auditCallbacks

  if (!callbacks) throw new Error(`Audit callbacks weren't initialized for ${modelClass.getModelName()}`)

  return callbacks
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
async function findOrCreateLookupId({columnName, currentDate, db, tableName, value}) {
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
  })

  const id = await findLookupId({columnName, db, tableName, value})

  if (id === null) throw new Error(`Couldn't find ${tableName}.${columnName} after upsert`)

  return id
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
async function findLookupId({columnName, db, tableName, value}) {
  const rows = /** @type {Array<{id: number | string}>} */ (await db.query(`
    SELECT ${db.quoteColumn("id")} AS id
    FROM ${db.quoteTable(tableName)}
    WHERE ${db.quoteColumn(columnName)} = ${db.quote(value)}
  `))

  if (rows[0]) return rows[0].id

  return null
}

/**
 * Normalizes an audit action string.
 * @param {string} action - Action name.
 * @returns {string} Trimmed, non-empty action name.
 */
function normalizeAction(action) {
  const normalizedAction = action.trim()

  if (!normalizedAction) throw new Error("Audit action must be present")

  return normalizedAction
}

// ---------------------------------------------------------------------------
// Migration helpers
// ---------------------------------------------------------------------------

/**
 * Creates the shared audit tables migration up/down callbacks for use inside
 * a Migration class. The `table` parameter is a Migration instance.
 * @param {{id?: {type: string}}} [options] - ID column options.
 * @returns {{down: (table: import("../migration/index.js").default) => Promise<void>, up: (table: import("../migration/index.js").default) => Promise<void>}} - Migration callbacks.
 */
function createSharedAuditTablesMigration(options = {}) {
  const opts = /** @type {{id?: {type: string}}} */ (options)
  const idOptions = /** @type {{type?: string}} */ (opts.id || {})
  const type = idOptions.type

  return {
    async up(table) {
      await table.createTable("audit_actions", {id: /** @type {{type?: string}} */ (opts.id || {})}, (/** @type {{string(name: string, options: Record<string, unknown>): void, timestamps(): void}} */ t) => {
        t.string("action", {index: {unique: true}, null: false})
        t.timestamps()
      })

      await table.createTable("audit_auditable_types", {id: /** @type {{type?: string}} */ (opts.id || {})}, (/** @type {{string(name: string, options: Record<string, unknown>): void, timestamps(): void}} */ t) => {
        t.string("name", {index: {unique: true}, null: false})
        t.timestamps()
      })

      await table.createTable("audits", {id: /** @type {{type?: string}} */ (opts.id || {})}, (/** @type {{json(name: string): void, references(name: string, options: Record<string, unknown>): void, timestamps(): void}} */ t) => {
        t.references("audit_action", {foreignKey: true, null: false, type})
        t.references("audit_auditable_type", {foreignKey: true, null: false, type})
        t.references("auditable", {null: false, polymorphic: true, type})
        t.json("audited_changes")
        t.json("params")
        t.timestamps()
      })
    },

    async down(table) {
      await table.dropTable("audits")
      await table.dropTable("audit_auditable_types")
      await table.dropTable("audit_actions")
    }
  }
}

/**
 * Returns the dedicated audit table name for a given model table name.
 * @param {string} modelTableName - Model table name (e.g. "projects").
 * @returns {string} Dedicated audit table name (e.g. "project_audits").
 */
function dedicatedAuditTableNameForTable(modelTableName) {
  if (modelTableName.endsWith("s")) {
    return `${modelTableName.slice(0, -1)}_audits`
  }

  return `${modelTableName}_audits`
}

export {
  AuditEvents,
  captureCreateAuditChanges,
  captureUpdateAuditChanges,
  createAudit,
  createCreateAudit,
  createDestroyAudit,
  createUpdateAudit,
  createSharedAuditTablesMigration,
  dedicatedAuditTableNameForTable,
  initializeAuditedModelRelationships,
  initializeAuditing,
  registerAuditCallback,
  registerAuditing,
  withoutAudit
}
