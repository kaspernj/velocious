// @ts-check

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
 *   _auditLifecycleCallbacksRegistered?: boolean
 * }} AuditedModelClass
 */

/**
 * Adds automatic create/update/destroy auditing callbacks to a model class.
 * @param {AuditedModelClass} modelClass - Model class to audit.
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

/**
 * Registers an audit event callback for a model/action pair.
 * @param {AuditedModelClass} modelClass - Model class to observe.
 * @param {string} action - Audit action name.
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

/**
 * Creates an audit row for a record.
 * @param {import("./index.js").default} record - Record to audit.
 * @param {CreateAuditArgs} args - Audit row options.
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
 * @param {import("./index.js").default} record - Record to audit.
 * @param {CreateAuditArgs} args - Audit row options.
 * @param {AuditedModelClass} modelClass - Audited model class.
 * @returns {Promise<number | string>} Created audit row id.
 */
async function createAuditWithCurrentConnection(record, args, modelClass) {
  if (!record.isPersisted()) throw new Error(`Cannot audit unpersisted ${modelClass.getModelName()} record`)

  const action = normalizeAction(args.action)
  const auditedChanges = args.auditedChanges === undefined ? null : args.auditedChanges
  const params = args.params === undefined ? null : args.params
  const db = modelClass.connection()
  const currentDate = new Date()
  const auditActionId = await findOrCreateLookupId({
    columnName: "action",
    db,
    tableName: "audit_actions",
    value: action,
    currentDate
  })
  const auditAuditableTypeId = await findOrCreateLookupId({
    columnName: "name",
    db,
    tableName: "audit_auditable_types",
    value: modelClass.getModelName(),
    currentDate
  })

  const insertResult = await db.query(db.insertSql({
    returnLastInsertedColumnNames: ["id"],
    tableName: "audits",
    data: {
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
  const auditId = auditIdFromInsertResult(insertResult) ?? await db.lastInsertID()

  await emitAuditEvent(modelClass, action, {
    action,
    auditId,
    auditedChanges,
    params,
    record
  })

  return auditId
}

/**
 * Reads an audit id returned by INSERT ... RETURNING / OUTPUT.
 * @param {Array<Record<string, ?>> | null | undefined} insertResult - Insert query result.
 * @returns {number | string | null} Created audit id when the driver returned it.
 */
function auditIdFromInsertResult(insertResult) {
  if (!Array.isArray(insertResult)) return null

  const row = insertResult[0]

  if (!row) return null

  const id = row.id

  if (typeof id == "number" || typeof id == "string") return id

  return null
}

/**
 * Captures create changes on a model instance.
 * @param {import("./index.js").default & {_pendingCreateAuditChanges?: AuditChanges}} record - Record to capture.
 * @returns {void}
 */
function captureCreateAuditChanges(record) {
  record._pendingCreateAuditChanges = auditChangesForCurrentChanges(record)
}

/**
 * Creates the create audit row for a model instance.
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
 * Captures update changes on a model instance.
 * @param {import("./index.js").default & {_pendingUpdateAuditChanges?: AuditChanges}} record - Record to capture.
 * @returns {void}
 */
function captureUpdateAuditChanges(record) {
  record._pendingUpdateAuditChanges = auditChangesForCurrentChanges(record)
}

/**
 * Creates the update audit row for a model instance.
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
 * Creates the destroy audit row for a model instance.
 * @param {import("./index.js").default} record - Record to audit.
 * @returns {Promise<void>}
 */
async function createDestroyAudit(record) {
  await createAudit(record, {
    action: "destroy",
    auditedChanges: auditChangesForDestroy(record)
  })
}

/**
 * Returns records without an audit row for the given action.
 * @template {AuditedModelClass} MC
 * @param {MC} modelClass - Model class to scope.
 * @param {string} action - Audit action to exclude.
 * @returns {import("../query/model-class-query.js").default<MC>} Query scoped to records without that audit action.
 */
function withoutAudit(modelClass, action) {
  const db = modelClass.connection()
  const modelTableSql = db.quoteTable(modelClass.tableName())
  const auditsTableSql = db.quoteTable("audits")
  const auditActionsTableSql = db.quoteTable("audit_actions")
  const modelPrimaryKeySql = `${modelTableSql}.${db.quoteColumn(modelClass.primaryKey())}`
  const auditAuditableIdSql = `${auditsTableSql}.${db.quoteColumn("auditable_id")}`
  const auditAuditableTypeSql = `${auditsTableSql}.${db.quoteColumn("auditable_type")}`
  const auditActionIdSql = `${auditsTableSql}.${db.quoteColumn("audit_action_id")}`
  const auditActionsIdSql = `${auditActionsTableSql}.${db.quoteColumn("id")}`
  const auditActionsActionSql = `${auditActionsTableSql}.${db.quoteColumn("action")}`

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

/**
 * Finds or creates a lookup row and returns its id.
 * @param {object} args - Options object.
 * @param {string} args.columnName - Lookup value column.
 * @param {Date} args.currentDate - Timestamp to write when inserting.
 * @param {import("../drivers/base.js").default} args.db - Database driver.
 * @param {string} args.tableName - Lookup table.
 * @param {string} args.value - Lookup value.
 * @returns {Promise<number | string>} Lookup row id.
 */
async function findOrCreateLookupId({columnName, currentDate, db, tableName, value}) {
  await db.upsert({
    tableName,
    conflictColumns: [columnName],
    updateColumns: [columnName],
    data: {
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
 * @param {string} args.columnName - Lookup value column.
 * @param {import("../drivers/base.js").default} args.db - Database driver.
 * @param {string} args.tableName - Lookup table.
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
 * Normalizes an audit action.
 * @param {string} action - Action name.
 * @returns {string} Normalized action.
 */
function normalizeAction(action) {
  const normalizedAction = action.trim()

  if (!normalizedAction) throw new Error("Audit action must be present")

  return normalizedAction
}

/**
 * Returns the callback map owned by a model class.
 * @param {AuditedModelClass} modelClass - Model class.
 * @returns {Record<string, AuditCallback[]>} Callback map.
 */
function auditCallbacksForModelClass(modelClass) {
  if (!Object.prototype.hasOwnProperty.call(modelClass, "_auditCallbacks")) {
    modelClass._auditCallbacks = {}
  }

  const callbacks = modelClass._auditCallbacks

  if (!callbacks) throw new Error(`Audit callbacks weren't initialized for ${modelClass.getModelName()}`)

  return callbacks
}

/**
 * Emits audit callbacks for a model/action pair.
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

export {
  captureCreateAuditChanges,
  captureUpdateAuditChanges,
  createAudit,
  createCreateAudit,
  createDestroyAudit,
  createUpdateAudit,
  registerAuditCallback,
  registerAuditing,
  withoutAudit
}
