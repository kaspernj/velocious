// @ts-check

import {scalarModelPrimaryKey, scalarModelPrimaryKeyValue} from "../../utils/model-primary-key.js"

/** @file Registers gap-less positional list callbacks on a model class. */

/**
 * Acts as list shifting.
 * @type {symbol} - Guard flag set on the model instance during shift operations to prevent re-entrant lifecycle hooks.
 */
const ACTS_AS_LIST_SHIFTING = Symbol("actsAsListShifting")

/**
 * Returns the scalar primary-key column required by acts-as-list SQL.
 * @param {typeof import("./index.js").default} modelClass - List model class.
 * @returns {string} - Scalar primary-key column.
 */
function actsAsListPrimaryKey(modelClass) {
  return scalarModelPrimaryKey(modelClass.primaryKey(), `actsAsList for ${modelClass.name}`)
}

/**
 * Returns the scalar record id required by acts-as-list SQL.
 * @param {import("./index.js").default} record - List record.
 * @returns {string | number} - Scalar record id.
 */
function actsAsListRecordId(record) {
  return scalarModelPrimaryKeyValue(record.id(), `actsAsList for ${record.getModelClass().name}`)
}

/**
 * Runs set shifting flag.
 * @param {import("./index.js").default} record - Model instance.
 * @param {boolean} value - Flag value.
 */
function setShiftingFlag(record, value) {
  // @ts-ignore - Symbol indexing on Record instances
  record[ACTS_AS_LIST_SHIFTING] = value
}

/**
 * Runs is shifting.
 * @param {import("./index.js").default} record - Model instance.
 * @returns {boolean} - Whether list positions are currently shifting.
 */
function isShifting(record) {
  // @ts-ignore - Symbol indexing on Record instances
  return Boolean(record[ACTS_AS_LIST_SHIFTING])
}

/**
 * Registers gap-less positional list callbacks on a model class to maintain
 * a gap-less positional list. When a record is inserted, updated, or
 * destroyed, the surrounding positions are shifted so the list stays compact
 * (1,2,3,...) and scoped within the given column.
 *
 * Callers must also ensure a UNIQUE index on (scopeColumn, positionColumn)
 * exists in the database schema — use `Migration.addActsAsList()` for the
 * corresponding schema setup.
 * @param {typeof import("./index.js").default} modelClass - The model class.
 * @param {string} positionColumn - camelCase name of the position attribute (e.g. "rowNumber").
 * @param {object} options - Options.
 * @param {string} options.scope - camelCase name of the scope attribute (e.g. "boardColumnId").
 * @returns {void}
 */
export default function registerActsAsListCallbacks(modelClass, positionColumn, {scope}) {
  modelClass.beforeCreate(async (record) => {
    if (isShifting(record)) return

    const position = record.readAttribute(positionColumn)

    if (position != null) {
      assertPositivePosition({position, positionColumn})
      await shiftPositionsUp({record, positionColumn, scope, fromPosition: position})
    } else {
      const nextPosition = await highestPositionInScope({record, positionColumn, scope})

      record.setAttribute(positionColumn, nextPosition + 1)
    }
  })

  modelClass.beforeUpdate(async (record) => {
    if (isShifting(record)) return
    if (!record.isPersisted()) return

    const modelClass = /** @type {typeof import("./index.js").default} */ (record.constructor)
    const posColumn = modelClass.getColumnNameForAttributeName(positionColumn)
    const scopeCol = modelClass.getColumnNameForAttributeName(scope)
    /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
    const rawAttributes = record._attributes || {}
    /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
    const changes = record._changes || {}
    /** @type {Set<string>} */
    const assignedAttributeNames = record._assignedAttributeNames || new Set()
    const posChanged = posColumn in changes
    const scopeChanged = scopeCol in changes
    const posAssigned = assignedAttributeNames.has(positionColumn)

    if (!posChanged && !scopeChanged) return

    assertPositivePosition({
      position: rawAttributes[posColumn],
      positionColumn,
      persisted: true
    })

    const oldPosition = posChanged ? /** @type {number} */ (rawAttributes[posColumn]) : /** @type {number} */ (record.readAttribute(positionColumn))
    const newPosition = posChanged ? /** @type {number} */ (changes[posColumn]) : /** @type {number} */ (record.readAttribute(positionColumn))
    const oldScopeValue = scopeChanged ? /** @type {number} */ (rawAttributes[scopeCol]) : /** @type {number} */ (record.readAttribute(scope))
    const newScopeValue = scopeChanged ? /** @type {number} */ (changes[scopeCol]) : /** @type {number} */ (record.readAttribute(scope))

    assertPositivePosition({position: newPosition, positionColumn})
    if (oldPosition == null) return
    if (newPosition === oldPosition && newScopeValue === oldScopeValue) return

    if (scopeChanged && oldScopeValue !== newScopeValue) {
      // When only the scope changes without a new position, append to the end
      // of the new scope. There is no target-scope row to shift out of the way.
      if (!posAssigned) {
        await moveOutOfWay({record, positionColumn, scope, scopeValue: oldScopeValue})
        setShiftingFlag(record, false)

        const highestNew = await highestPositionInScope({record, positionColumn, scope, scopeValue: newScopeValue})
        const nextPos = highestNew + 1

        record.setAttribute(positionColumn, nextPos)
        await shiftPositionsDown({record, positionColumn, scope, scopeValue: oldScopeValue, fromPosition: oldPosition + 1})
        return
      }

      await moveOutOfWay({record, positionColumn, scope, scopeValue: oldScopeValue})
      setShiftingFlag(record, false)
      await shiftPositionsDown({record, positionColumn, scope, scopeValue: oldScopeValue, fromPosition: oldPosition + 1})
      await shiftPositionsUp({record, positionColumn, scope, scopeValue: newScopeValue, fromPosition: newPosition, excludeRecordId: actsAsListRecordId(record)})
      await placeMovedRecord({record, positionColumn, scope, scopeValue: newScopeValue, position: newPosition})
      return
    }

    await moveOutOfWay({record, positionColumn, scope, scopeValue: oldScopeValue})
    setShiftingFlag(record, false)

    if (newPosition < oldPosition) {
      await shiftPositionsUp({record, positionColumn, scope, fromPosition: newPosition, toPosition: oldPosition})
    } else if (newPosition > oldPosition) {
      await shiftPositionsDown({record, positionColumn, scope, fromPosition: oldPosition + 1, toPosition: newPosition + 1})
    }
  })

  modelClass.beforeDestroy(async (record) => {
    const position = record.readAttribute(positionColumn)

    if (position == null) {
      const modelClass = /** @type {typeof import("./index.js").default} */ (record.constructor)
      const posColumn = modelClass.getColumnNameForAttributeName(positionColumn)

      if (posColumn in record._attributes) assertPositivePosition({position, positionColumn, persisted: true})
      return
    }
    assertPositivePosition({position, positionColumn, persisted: true})

    await moveOutOfWay({record, positionColumn, scope})
    setShiftingFlag(record, false)

    await shiftPositionsDown({record, positionColumn, scope, fromPosition: position + 1})
  })
}

/**
 * Enforces the public gap-less list position invariant before any shifting.
 * @param {object} args - Arguments.
 * @param {number | null | undefined} args.position - Position to validate.
 * @param {string} args.positionColumn - Position attribute name.
 * @param {boolean} [args.persisted] - Whether the invalid value came from persisted state.
 * @returns {void}
 */
function assertPositivePosition({position, positionColumn, persisted = false}) {
  if (typeof position === "number" && Number.isInteger(position) && position > 0) return

  const source = persisted ? "Persisted" : "Requested"

  throw new Error(`${source} actsAsList ${positionColumn} must be a positive integer`)
}

/**
 * Places a moved row after surrounding rows have shifted.
 * @param {object} args - Arguments.
 * @param {import("./index.js").default} args.record - Model instance.
 * @param {string} args.positionColumn - Position attribute name.
 * @param {string} args.scope - Scope attribute name.
 * @param {string | number} args.scopeValue - Destination scope value.
 * @param {number} args.position - Destination position.
 * @returns {Promise<void>} Resolves after placement.
 */
async function placeMovedRecord({record, positionColumn, scope, scopeValue, position}) {
  const modelClass = /** @type {typeof import("./index.js").default} */ (record.constructor)
  const connection = record.connection()
  const tableSql = connection.quoteTable(modelClass._getTable().getName())
  const scopeCol = modelClass.getColumnNameForAttributeName(scope)
  const posCol = modelClass.getColumnNameForAttributeName(positionColumn)
  const preservedChanges = {...record._changes}
  const scopeColumnSql = connection.quoteColumn(scopeCol)
  const positionColumnSql = connection.quoteColumn(posCol)
  const primaryKey = actsAsListPrimaryKey(modelClass)
  const primaryKeySql = connection.quoteColumn(primaryKey)
  const recordId = actsAsListRecordId(record)

  delete preservedChanges[scopeCol]
  delete preservedChanges[posCol]

  await connection.query(
    `UPDATE ${tableSql} SET ${scopeColumnSql} = ${connection.quote(scopeValue)}, ${positionColumnSql} = ${connection.quote(position)} WHERE ${primaryKeySql} = ${connection.quote(recordId)}`
  )
  await record._reloadWithId(recordId)
  record._changes = preservedChanges
  clearBelongsToChangeForScope(record)
}

/**
 * Clears dirty belongs-to state for the scope FK after direct placement.
 * @param {import("./index.js").default} record - Model instance.
 * @returns {void} Nothing.
 */
function clearBelongsToChangeForScope(record) {
  for (const relationshipName in record._instanceRelationships || {}) {
    const relationship = record._instanceRelationships[relationshipName]

    if (relationship.getType() !== "belongsTo") continue

    relationship.setDirty(false)
  }
}

/**
 * Bumps positions UP by 1 in the range [fromPosition, toPosition) within the
 * same scope. Updates in descending order to avoid intermediate UNIQUE
 * constraint violations.
 * @param {object} args - Arguments.
 * @param {import("./index.js").default} args.record - The model instance whose scope is the source of truth.
 * @param {string} args.positionColumn - camelCase position attribute name.
 * @param {string} args.scope - camelCase scope attribute name.
 * @param {number} args.fromPosition - Starting position (inclusive).
 * @param {number} [args.toPosition] - Ending position (exclusive).
 * @param {string | number} [args.scopeValue] - Explicit scope value.
 * @param {string | number} [args.excludeRecordId] - Record id to exclude from shifts.
 * @returns {Promise<void>}
 */
async function shiftPositionsUp({record, positionColumn, scope, fromPosition, toPosition, scopeValue, excludeRecordId}) {
  const modelClass = /** @type {typeof import("./index.js").default} */ (record.constructor)
  const connection = record.connection()
  const tableName = modelClass._getTable().getName()
  const resolvedScopeValue = scopeValue != null ? scopeValue : resolveScopeValue(record, scope)
  const scopeColumnName = modelClass.getColumnNameForAttributeName(scope)

  if (resolvedScopeValue == null) return

  const positionColumnName = modelClass.getColumnNameForAttributeName(positionColumn)
  const positionColumnSql = connection.quoteColumn(positionColumnName)
  const scopeColumnSql = connection.quoteColumn(scopeColumnName)
  const primaryKey = actsAsListPrimaryKey(modelClass)
  const primaryKeySql = connection.quoteColumn(primaryKey)
  const tableSql = connection.quoteTable(tableName)
  const quotedScope = connection.quote(resolvedScopeValue)

  // Load rows in descending order so we bump the highest first
  let query = record
    .queryForModel(modelClass)
    .select(primaryKey)
    .select(positionColumn)
    .where({[scopeColumnName]: resolvedScopeValue})
    .where(`${positionColumnSql} >= ${connection.quote(fromPosition)}`)
    .where(`${positionColumnSql} > 0`)
    .order(`${positionColumnSql} DESC`)

  const recordIdToExclude = excludeRecordId || (record.isPersisted() ? actsAsListRecordId(record) : null)

  if (recordIdToExclude != null) {
    query = query.where(`${primaryKeySql} != ${connection.quote(recordIdToExclude)}`)
  }

  if (toPosition != null) {
    query = query.where(`${positionColumnSql} < ${connection.quote(toPosition)}`)
  }

  const rows = await query.toArray()

  setShiftingFlag(record, true)

  try {
    for (const row of rows) {
      const currentPos = Number(row.readAttribute(positionColumn))

      await connection.query(
        `UPDATE ${tableSql} SET ${positionColumnSql} = ${positionColumnSql} + 1 WHERE ${primaryKeySql} = ${connection.quote(row.id())} AND ${scopeColumnSql} = ${quotedScope} AND ${positionColumnSql} = ${connection.quote(currentPos)}`
      )
    }
  } finally {
    setShiftingFlag(record, false)
  }
}

/**
 * Bumps positions DOWN by 1 in the range [fromPosition, toPosition) within
 * the same scope. Updates in ascending order to avoid intermediate UNIQUE
 * constraint violations.
 * @param {object} args - Arguments.
 * @param {import("./index.js").default} args.record - The model instance whose scope is the source of truth.
 * @param {string} args.positionColumn - camelCase position attribute name.
 * @param {string} args.scope - camelCase scope attribute name.
 * @param {number} args.fromPosition - Starting position (inclusive).
 * @param {number} [args.toPosition] - Ending position (exclusive).
 * @param {string | number} [args.scopeValue] - Explicit scope value.
 * @returns {Promise<void>}
 */
async function shiftPositionsDown({record, positionColumn, scope, fromPosition, toPosition, scopeValue}) {
  const modelClass = /** @type {typeof import("./index.js").default} */ (record.constructor)
  const connection = record.connection()
  const tableName = modelClass._getTable().getName()
  const resolvedScopeValue = scopeValue != null ? scopeValue : resolveScopeValue(record, scope)
  const scopeColumnName = modelClass.getColumnNameForAttributeName(scope)

  if (resolvedScopeValue == null) return

  const positionColumnName = modelClass.getColumnNameForAttributeName(positionColumn)
  const positionColumnSql = connection.quoteColumn(positionColumnName)
  const scopeColumnSql = connection.quoteColumn(scopeColumnName)
  const primaryKey = actsAsListPrimaryKey(modelClass)
  const primaryKeySql = connection.quoteColumn(primaryKey)
  const tableSql = connection.quoteTable(tableName)
  const quotedScope = connection.quote(resolvedScopeValue)

  // Load rows in ascending order so we shift the lowest gap first
  let query = record
    .queryForModel(modelClass)
    .select(primaryKey)
    .select(positionColumn)
    .where({[scopeColumnName]: resolvedScopeValue})
    .where(`${positionColumnSql} >= ${connection.quote(fromPosition)}`)
    .where(`${positionColumnSql} > 0`)
    .where(`${primaryKeySql} != ${connection.quote(actsAsListRecordId(record))}`)
    .order({column: positionColumnName, direction: "ASC"})

  if (toPosition != null) {
    query = query.where(`${positionColumnSql} < ${connection.quote(toPosition)}`)
  }

  const rows = await query.toArray()

  setShiftingFlag(record, true)

  try {
    for (const row of rows) {
      const currentPos = Number(row.readAttribute(positionColumn))

      await connection.query(
        `UPDATE ${tableSql} SET ${positionColumnSql} = ${positionColumnSql} - 1 WHERE ${primaryKeySql} = ${connection.quote(row.id())} AND ${scopeColumnSql} = ${quotedScope} AND ${positionColumnSql} = ${connection.quote(currentPos)}`
      )
    }
  } finally {
    setShiftingFlag(record, false)
  }
}

/**
 * Returns the highest current position value in the record's scope.
 * @param {object} args - Arguments.
 * @param {import("./index.js").default} args.record - The model instance whose scope is the source of truth.
 * @param {string} args.positionColumn - camelCase position attribute name.
 * @param {string} args.scope - camelCase scope attribute name.
 * @param {string | number} [args.scopeValue] - Explicit scope value.
 * @returns {Promise<number>} - Highest position in scope, or 0 when scope is empty.
 */
async function highestPositionInScope({record, positionColumn, scope, scopeValue}) {
  const modelClass = /** @type {typeof import("./index.js").default} */ (record.constructor)
  const connection = record.connection()
  const scopeColumnName = modelClass.getColumnNameForAttributeName(scope)
  const positionColumnName = modelClass.getColumnNameForAttributeName(positionColumn)
  const positionColumnSql = connection.quoteColumn(positionColumnName)
  const resolvedScopeValue = scopeValue != null ? scopeValue : resolveScopeValue(record, scope)

  if (resolvedScopeValue == null) return 0

  const rows = await record
    .queryForModel(modelClass)
    .select(positionColumn)
    .where({[scopeColumnName]: resolvedScopeValue})
    .order(`${positionColumnSql} DESC`)
    .limit(1)
    .toArray()

  if (rows.length === 0) return 0

  return Number(rows[0].readAttribute(positionColumn)) || 0
}

/**
 * Resolves a scope value from the attribute store first, then falls back
 * to the loaded belongsTo relationship. This is needed during beforeCreate
 * because the FK attribute may not be set until _createNewRecord flushes
 * _belongsToChanges.
 * @param {import("./index.js").default} record - Model instance.
 * @param {string} scope - camelCase scope attribute name (e.g. "projectId").
 * @returns {string | number | null} - Current list position value.
 */
function resolveScopeValue(record, scope) {
  const attrValue = record.readAttribute(scope)

  if (attrValue != null) return /** @type {string | number} */ (attrValue)

  const modelClass = /** @type {typeof import("./index.js").default} */ (record.constructor)
  const relationships = modelClass.getRelationshipsMap()
  const scopeColumnName = modelClass.getColumnNameForAttributeName(scope)

  for (const relationshipName in relationships) {
    const relationship = relationships[relationshipName]

    if (relationship.getType?.() !== "belongsTo") continue

    const foreignKey = relationship.getForeignKey()

    if (foreignKey !== scopeColumnName) continue

    const instanceRelationship = record.getRelationshipByName(relationshipName)
    const loaded = instanceRelationship.loaded()

    if (loaded && !Array.isArray(loaded) && typeof loaded.id === "function") {
      return scalarModelPrimaryKeyValue(loaded.id(), `actsAsList scope relationship for ${modelClass.name}`)
    }
  }

  return null
}

/**
 * Moves the record to a temporary position outside the normal range so
 * that surrounding position shifts do not hit unique constraint violations.
 * @param {object} args - Arguments.
 * @param {import("./index.js").default} args.record - Model instance.
 * @param {string} args.positionColumn - camelCase position attribute.
 * @param {string} args.scope - camelCase scope attribute.
 * @param {string | number | null} [args.scopeValue] - Scope containing the record before move-out.
 * @returns {Promise<void>}
 */
async function moveOutOfWay({record, positionColumn, scope, scopeValue}) {
  const modelClass = /** @type {typeof import("./index.js").default} */ (record.constructor)
  const connection = record.connection()
  const tableName = modelClass._getTable().getName()
  const resolvedScopeValue = scopeValue != null ? scopeValue : resolveScopeValue(record, scope)

  if (resolvedScopeValue == null) return

  const positionColumnSql = connection.quoteColumn(modelClass.getColumnNameForAttributeName(positionColumn))
  const scopeColumnSql = connection.quoteColumn(modelClass.getColumnNameForAttributeName(scope))
  const tableSql = connection.quoteTable(tableName)
  const pkSql = connection.quoteColumn(actsAsListPrimaryKey(modelClass))

  setShiftingFlag(record, true)

  try {
    await connection.query(
      `UPDATE ${tableSql} SET ${positionColumnSql} = -${positionColumnSql} WHERE ${scopeColumnSql} = ${connection.quote(resolvedScopeValue)} AND ${pkSql} = ${connection.quote(actsAsListRecordId(record))}`
    )
  } finally {
    // Don't clear the flag here — the caller will do that after shifts
  }
}
