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

// ---------------------------------------------------------------------------
// Global event bus (like ActiveRecordAuditable::Events)
// ---------------------------------------------------------------------------

/** @type {Record<string, Record<string, Array<(args: AuditEventPayload) => void>>>} */
let globalEventConnections = {}

const AuditEvents = {
  /** @param {string} type @param {string} action @param {AuditEventPayload} args */
  call(type, action, args) {
    const actions = globalEventConnections[type] || {}
    const callbacks = actions[action] || []

    for (const callback of [...callbacks]) {
      callback(args)
    }
  },

  /** @param {string} type @param {string} action @param {(args: AuditEventPayload) => void} callback @returns {() => void} */
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

  reset() {
    globalEventConnections = {}
  }
}

// ---------------------------------------------------------------------------
// Table detection
// ---------------------------------------------------------------------------

/**
 * @param {AuditedModelClass} modelClass
 * @returns {string}
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
 * @param {AuditedModelClass} modelClass - Audited model class.
 * @returns {Promise<AuditTableData>}
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

  // Register relationships now that we know the table type.
  if (!modelClass._relationshipExists("audits")) {
    modelClass.hasMany("audits", (query) => query.order({column: "created_at", direction: "DESC"}), {foreignKey: tableData.foreignKey, klass: tableData.auditClass, polymorphic: !tableData.dedicated})
  }

  return tableData
}

/**
 * @param {AuditedModelClass} modelClass
 * @returns {Promise<AuditTableData>}
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

  const cacheKey = `shared:${modelClass.getConfiguredDatabaseIdentifier()}`
  let auditClass = auditClassCache.get(cacheKey)

  if (!auditClass) {
    auditClass = sharedAuditClass(modelClass)
    auditClassCache.set(cacheKey, auditClass)
  }

  return {
    auditClass,
    dedicated: false,
    foreignKey: "auditable_id",
    tableName: "audits"
  }
}

/**
 * @param {AuditedModelClass} modelClass
 * @param {string} tableName
 * @returns {Promise<boolean>}
 */
async function dedicatedTableExistsForConnection(modelClass, tableName) {
  const cacheKey = `${modelClass.getConfiguredDatabaseIdentifier()}:${tableName}`
  const cached = dedicatedTableCache.get(cacheKey)

  if (typeof cached === "boolean") {
    return cached
  }

  try {
    const connection = modelClass.connection()
    const table = await connection.getTableByName(tableName)

    dedicatedTableCache.set(cacheKey, true)

    return true
  } catch {
    dedicatedTableCache.set(cacheKey, false)

    return false
  }
}

// ---------------------------------------------------------------------------
// Dynamic audit classes
// ---------------------------------------------------------------------------

/**
 * @param {AuditedModelClass} modelClass
 * @returns {typeof import("./index.js").default}
 */
function sharedAuditClass(modelClass) {
  const dbRecordClass = findDatabaseRecordClass(modelClass)

  class Audit extends dbRecordClass {
    /** @returns {string} */
    static tableName() {
      return "audits"
    }
  }

  Object.defineProperty(Audit, "modelName", {value: "Audit", writable: false})

  return /** @type {typeof import("./index.js").default} */ (Audit)
}

/**
 * @param {AuditedModelClass} modelClass
 * @param {string} tableName
 * @returns {typeof import("./index.js").default}
 */
function dedicatedAuditClass(modelClass, tableName) {
  const dbRecordClass = findDatabaseRecordClass(modelClass)
  const modelName = modelClass.getModelName()
  const modelKey = modelParamKey(modelClass)

  class ModelAudit extends dbRecordClass {
    /** @returns {string} */
    static tableName() {
      return tableName
    }
  }

  Object.defineProperty(ModelAudit, "modelName", {value: `${modelName}Audit`, writable: false})

  ModelAudit.belongsTo(modelKey, {className: modelName})

  return /** @type {typeof import("./index.js").default} */ (ModelAudit)
}

/**
 * Walks the prototype chain of modelClass to find the root DatabaseRecord.
 * @param {AuditedModelClass} modelClass
 * @returns {typeof import("./index.js").default}
 */
function findDatabaseRecordClass(modelClass) {
  let recordClass = Object.getPrototypeOf(modelClass)

  while (recordClass && Object.getPrototypeOf(recordClass) !== Function.prototype) {
    recordClass = Object.getPrototypeOf(recordClass)
  }

  return /** @type {typeof import("./index.js").default} */ (recordClass)
}

/**
 * @param {AuditedModelClass} modelClass
 * @returns {string}
 */
function modelParamKey(modelClass) {
  const name = modelClass.getModelName()

  return name.charAt(0).toLowerCase() + name.slice(1)
}

// ---------------------------------------------------------------------------
// Registration (sync — callbacks only; table detection deferred)
// ---------------------------------------------------------------------------

/**
 * Registers lifecycle callbacks and schedules deferred relationship
 * registration on first audit access. Called synchronously from
 * Model.audited() at module-load time.
 * @param {AuditedModelClass} modelClass
 * @returns {void}
 */
function registerAuditing(modelClass) {
  if (Object.prototype.hasOwnProperty.call(modelClass, "_auditLifecycleCallbacksRegistered") && modelClass._auditLifecycleCallbacksRegistered) {
    return
  }

  modelClass._auditLifecycleCallbacksRegistered = true
  modelClass.beforeCreate("captureCreateAuditChanges")
  modelClass.afterCreate("createCreateAudit")
  modelClass.beforeUpdate("captureUpdateAuditChanges")
  modelClass.afterUpdate("createUpdateAudit")
  modelClass.afterDestroy("createDestroyAudit")
}

// ---------------------------------------------------------------------------
// Creating audits
// ---------------------------------------------------------------------------

/**
 * @param {import("./index.js").default} record
 * @param {CreateAuditArgs} args
 * @returns {Promise<number | string>}
 */
async function createAudit(record, args) {
  const modelClass = /** @type {AuditedModelClass} */ (record.getModelClass())

  return await modelClass._getConfiguration().ensureConnections({name: `${modelClass.getModelName()} audit`}, async () => {
    return await createAuditWithCurrentConnection(record, args, modelClass)
  })
}

/**
 * @param {import("./index.js").default} record
 * @param {CreateAuditArgs} args
 * @param {AuditedModelClass} modelClass
 * @returns {Promise<number | string>}
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
 * @param {import("./index.js").default & {_pendingCreateAuditChanges?: AuditChanges}} record
 * @returns {void}
 */
function captureCreateAuditChanges(record) {
  record._pendingCreateAuditChanges = auditChangesForCurrentChanges(record)
}

/**
 * @param {import("./index.js").default & {_pendingCreateAuditChanges?: AuditChanges}} record
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
 * @param {import("./index.js").default & {_pendingUpdateAuditChanges?: AuditChanges}} record
 * @returns {void}
 */
function captureUpdateAuditChanges(record) {
  record._pendingUpdateAuditChanges = auditChangesForCurrentChanges(record)
}

/**
 * @param {import("./index.js").default & {_pendingUpdateAuditChanges?: AuditChanges}} record
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
 * @param {import("./index.js").default} record
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
 * @param {import("./index.js").default} record
 * @returns {AuditChanges}
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
 * @param {import("./index.js").default} record
 * @returns {AuditChanges}
 */
function auditChangesForDestroy(record) {
  return {...record.attributes()}
}

// ---------------------------------------------------------------------------
// withoutAudit
// ---------------------------------------------------------------------------

/**
 * @template {AuditedModelClass} MC
 * @param {MC} modelClass
 * @param {string} action
 * @returns {import("../query/model-class-query.js").default<MC>}
 */
function withoutAudit(modelClass, action) {
  const db = modelClass.connection()
  const modelTableSql = db.quoteTable(modelClass.tableName())
  const auditActionsTableSql = db.quoteTable("audit_actions")
  const modelPrimaryKeySql = `${modelTableSql}.${db.quoteColumn(modelClass.primaryKey())}`
  const auditActionsIdSql = `${auditActionsTableSql}.${db.quoteColumn("id")}`
  const auditActionsActionSql = `${auditActionsTableSql}.${db.quoteColumn("action")}`

  // When table data is already resolved and a dedicated table exists, use it.
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

  // Default: shared audits table.
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
 * @param {AuditedModelClass} modelClass
 * @param {string} action
 * @param {AuditCallback} callback
 * @returns {() => void}
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
 * @param {AuditedModelClass} modelClass
 * @param {string} action
 * @param {AuditEventPayload} payload
 * @returns {Promise<void>}
 */
async function emitAuditEvent(modelClass, action, payload) {
  const callbacks = auditCallbacksForModelClass(modelClass)[action] || []

  for (const callback of [...callbacks]) {
    await callback(payload)
  }
}

/**
 * @param {AuditedModelClass} modelClass
 * @returns {Record<string, AuditCallback[]>}
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
 * @param {{columnName: string, currentDate: Date, db: import("../drivers/base.js").default, tableName: string, value: string}} args
 * @returns {Promise<number | string>}
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
 * @param {{columnName: string, db: import("../drivers/base.js").default, tableName: string, value: string}} args
 * @returns {Promise<number | string | null>}
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
 * @param {string} action
 * @returns {string}
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
 * @returns {{down: (table: any) => Promise<void>, up: (table: any) => Promise<void>}}
 */
function createSharedAuditTablesMigration(options = {}) {
  const opts = /** @type {{id?: {type: string}}} */ (options)
  const idOptions = /** @type {{type?: string}} */ (opts.id || {})
  const type = idOptions.type

  return {
    async up(table) {
      await table.createTable("audit_actions", {id: idOptions}, (/** @type {*} */ t) => {
        t.string("action", {index: {unique: true}, null: false})
        t.timestamps()
      })

      await table.createTable("audit_auditable_types", {id: idOptions}, (/** @type {*} */ t) => {
        t.string("name", {index: {unique: true}, null: false})
        t.timestamps()
      })

      await table.createTable("audits", {id: idOptions}, (/** @type {*} */ t) => {
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
 * @param {string} modelTableName
 * @returns {string}
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
  registerAuditCallback,
  registerAuditing,
  withoutAudit
}
