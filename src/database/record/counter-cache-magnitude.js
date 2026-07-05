// @ts-check

/**
 * Reactive counter-cache driven by a per-record magnitude.
 *
 * Maintains a counter column on a `belongsTo` parent as the running sum of each
 * child's magnitude — a small number derived from one source attribute (e.g.
 * `1` while a build's `status` is `running`, else `0`). On every create, update
 * and destroy the change in magnitude is applied to the parent as a single
 * atomic increment (`SET col = col + delta`), and when the foreign key changes
 * the magnitude is moved from the old parent to the new one.
 *
 * Because the counter is derived from the source attribute and diffed on every
 * write, it follows that attribute automatically no matter which code path wrote
 * it — there is no per-transition increment/decrement to forget. The old value is
 * captured in `beforeSave` (Velocious clears `changes()` during the post-update
 * reload) and consumed in `afterSave`, so the increment commits atomically with
 * the row it reflects.
 * @typedef {{
 *   belongsTo: string,
 *   counterColumn: string,
 *   sourceAttribute: string,
 *   magnitude: (sourceValue: ?) => number
 * }} MagnitudeCounterCacheDefinition
 */

/**
 * Captured pending magnitude change stashed on a record between beforeSave and afterSave.
 * @typedef {{newMagnitude: number, oldMagnitude: number, newParentId: ?, oldParentId: ?}} PendingMagnitudeDelta
 */

/**
 * Registers a reactive magnitude counter-cache on a model class.
 * @param {typeof import("./index.js").default} modelClass - Model class to add the counter cache to.
 * @param {MagnitudeCounterCacheDefinition} definition - Counter cache definition.
 * @returns {void}
 */
export function registerMagnitudeCounterCache(modelClass, definition) {
  /**
   * Dynamic class.
   * @type {?} */
  const dynamicClass = modelClass
  const registeredFlag = `_magnitudeCounterCacheRegistered_${definition.counterColumn}`

  // Idempotent per counter column: re-declaring (or subclassing) must not double-register.
  if (Object.prototype.hasOwnProperty.call(dynamicClass, registeredFlag) && dynamicClass[registeredFlag]) {
    return
  }

  dynamicClass[registeredFlag] = true

  const pendingKey = `_magnitudeCounterCachePending_${definition.counterColumn}`

  modelClass.beforeSave(async function (record) {
    /**
     * Dynamic record.
     * @type {?} */
    const dynamicRecord = record

    dynamicRecord[pendingKey] = computePendingMagnitudeDelta(record, definition)
  })

  modelClass.afterSave(async function (record) {
    /**
     * Dynamic record.
     * @type {?} */
    const dynamicRecord = record
    const pending = /** @type {PendingMagnitudeDelta | null} */ (dynamicRecord[pendingKey])

    dynamicRecord[pendingKey] = null

    if (pending) {
      await applyPendingMagnitudeDelta(record, definition, pending)
    }
  })

  modelClass.afterDestroy(async function (record) {
    const magnitude = definition.magnitude(record.readAttribute(definition.sourceAttribute))
    const parentId = currentParentId(record, definition)

    if (parentId && magnitude !== 0) {
      await incrementParentCounter(record, definition, parentId, -magnitude)
    }
  })
}

/**
 * Diffs the source attribute (and foreign key) across the pending save to capture
 * how the parent counter should move. Runs in beforeSave, where `changes()` still
 * holds the pre-save values.
 * @param {import("./index.js").default} record - Record being saved.
 * @param {MagnitudeCounterCacheDefinition} definition - Counter cache definition.
 * @returns {PendingMagnitudeDelta} The captured magnitude change.
 */
function computePendingMagnitudeDelta(record, definition) {
  const changes = record.changes()
  const sourceColumn = columnNameForAttribute(record, definition.sourceAttribute)
  const foreignKeyColumn = record.getModelClass().getRelationshipByName(definition.belongsTo).getForeignKey()

  const newSource = record.readAttribute(definition.sourceAttribute)
  const oldSource = oldSourceValueThroughReadCast(record, definition.sourceAttribute, sourceColumn, changes, newSource)

  const newParentId = currentParentId(record, definition)
  const oldParentId = foreignKeyColumn in changes ? changes[foreignKeyColumn][0] : newParentId

  return {
    newMagnitude: definition.magnitude(newSource),
    oldMagnitude: definition.magnitude(oldSource),
    newParentId,
    oldParentId
  }
}

/**
 * Applies a captured magnitude change to the parent counter(s) as atomic increments.
 * @param {import("./index.js").default} record - Record that was saved.
 * @param {MagnitudeCounterCacheDefinition} definition - Counter cache definition.
 * @param {PendingMagnitudeDelta} pending - The captured magnitude change.
 * @returns {Promise<void>}
 */
async function applyPendingMagnitudeDelta(record, definition, pending) {
  const {newMagnitude, oldMagnitude, newParentId, oldParentId} = pending

  if (oldParentId === newParentId) {
    const delta = newMagnitude - oldMagnitude

    if (newParentId && delta !== 0) {
      await incrementParentCounter(record, definition, newParentId, delta)
    }

    return
  }

  // The foreign key moved: take the old magnitude off the old parent and put the
  // new magnitude on the new parent.
  if (oldParentId && oldMagnitude !== 0) {
    await incrementParentCounter(record, definition, oldParentId, -oldMagnitude)
  }

  if (newParentId && newMagnitude !== 0) {
    await incrementParentCounter(record, definition, newParentId, newMagnitude)
  }
}

/**
 * Reads the pre-save value of the source attribute through the normal read/cast
 * path, so `magnitude` receives the old value in the same shape as the new one
 * (e.g. a declared boolean as `true`/`false`, not the raw stored `1`/`0`). Drops
 * the pending change so `readAttribute` falls back to the committed value and
 * applies the same cast a fresh read would, then restores the pending change.
 * @param {import("./index.js").default} record - Record being saved.
 * @param {string} sourceAttribute - Source attribute name.
 * @param {string} sourceColumn - Source column name.
 * @param {Record<string, ?>} changes - The record's pre-save changes (column-keyed).
 * @param {?} currentValue - The current (new) read value, returned when the source did not change.
 * @returns {?} The read-cast pre-save value.
 */
function oldSourceValueThroughReadCast(record, sourceAttribute, sourceColumn, changes, currentValue) {
  if (!(sourceColumn in changes)) {
    return currentValue
  }

  /**
   * Dynamic record.
   * @type {?} */
  const dynamicRecord = record
  const pendingChange = dynamicRecord._changes[sourceColumn]

  delete dynamicRecord._changes[sourceColumn]

  try {
    return record.readAttribute(sourceAttribute)
  } finally {
    dynamicRecord._changes[sourceColumn] = pendingChange
  }
}

/**
 * Reads the record's current foreign-key value for the counter-cache parent.
 * @param {import("./index.js").default} record - Record whose parent is targeted.
 * @param {MagnitudeCounterCacheDefinition} definition - Counter cache definition.
 * @returns {?} The current foreign-key value.
 */
function currentParentId(record, definition) {
  const foreignKeyColumn = record.getModelClass().getRelationshipByName(definition.belongsTo).getForeignKey()

  return record.readAttribute(attributeNameForColumn(record, foreignKeyColumn))
}

/**
 * Atomically adds `amount` to the parent's counter column for one parent row.
 * @param {import("./index.js").default} record - Child record (for connection + relationship metadata).
 * @param {MagnitudeCounterCacheDefinition} definition - Counter cache definition.
 * @param {?} parentId - Parent primary-key value.
 * @param {number} amount - Signed integer to add.
 * @returns {Promise<void>}
 */
async function incrementParentCounter(record, definition, parentId, amount) {
  const modelClass = record.getModelClass()
  const relationship = modelClass.getRelationshipByName(definition.belongsTo)
  const parentModelClass = relationship.getTargetModelClass()

  if (!parentModelClass) {
    throw new Error(`magnitudeCounterCache on ${modelClass.getModelName()} could not resolve the "${definition.belongsTo}" parent model class`)
  }

  // Update through the PARENT model's connection: the row being modified belongs
  // to the parent, which may live on a different database/tenant than the child.
  const db = parentModelClass.connection()
  const counterColumnSql = db.quoteColumn(definition.counterColumn)
  const truncatedAmount = Math.trunc(amount)

  await db.query(
    `UPDATE ${db.quoteTable(parentModelClass.tableName())} ` +
    `SET ${counterColumnSql} = COALESCE(${counterColumnSql}, 0) + ${truncatedAmount} ` +
    `WHERE ${db.quoteColumn(relationship.getPrimaryKey())} = ${db.quote(parentId)}`
  )
}

/**
 * Resolves the column name backing an attribute name.
 * @param {import("./index.js").default} record - Record.
 * @param {string} attributeName - Attribute name.
 * @returns {string} The column name for the attribute (falls back to the attribute name).
 */
function columnNameForAttribute(record, attributeName) {
  return record.getModelClass().getAttributeNameToColumnNameMap()[attributeName] || attributeName
}

/**
 * Resolves the attribute name backing a column name.
 * @param {import("./index.js").default} record - Record.
 * @param {string} columnName - Column name.
 * @returns {string} The attribute name for the column (falls back to the column name).
 */
function attributeNameForColumn(record, columnName) {
  const map = record.getModelClass().getAttributeNameToColumnNameMap()

  return Object.keys(map).find((attributeName) => map[attributeName] === columnName) || columnName
}
