// @ts-check

/** @file Registers gap-less positional list callbacks on a model class. */

import * as inflection from "inflection"

/**
 * Acts as list shifting.
 * @type {symbol} - Guard flag set on the model instance during shift operations to prevent re-entrant lifecycle hooks.
 */
const ACTS_AS_LIST_SHIFTING = Symbol("actsAsListShifting")

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
 * @returns {boolean}
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
      await shiftPositionsUp({record, positionColumn, scope, fromPosition: position})
    } else {
      const nextPosition = await highestPositionInScope({record, positionColumn, scope})

      record.setAttribute(positionColumn, nextPosition + 1)
    }
  })

  modelClass.beforeUpdate(async (record) => {
    if (isShifting(record)) return
    if (!record.isPersisted()) return

    const posColumn = inflection.underscore(positionColumn)
    const scopeCol = inflection.underscore(scope)
    const rawAttributes = /**
                           * Narrows the runtime value to the documented type.
                            @type {Record<string, ?>} */ (record._attributes || {})
    const changes = /**
                     * Narrows the runtime value to the documented type.
                      @type {Record<string, ?>} */ (record._changes || {})
    const posChanged = posColumn in changes
    const scopeChanged = scopeCol in changes

    if (!posChanged && !scopeChanged) return

    const oldPosition = posChanged ? /**
                                      * Narrows the runtime value to the documented type.
                                       @type {number} */ (rawAttributes[posColumn]) : /**
                                                                                       * Narrows the runtime value to the documented type.
                                                                                        @type {number} */ (record.readAttribute(positionColumn))
    const newPosition = posChanged ? /**
                                      * Narrows the runtime value to the documented type.
                                       @type {number} */ (changes[posColumn]) : /**
                                                                                 * Narrows the runtime value to the documented type.
                                                                                  @type {number} */ (record.readAttribute(positionColumn))
    const oldScopeValue = scopeChanged ? /**
                                          * Narrows the runtime value to the documented type.
                                           @type {number} */ (rawAttributes[scopeCol]) : /**
                                                                                          * Narrows the runtime value to the documented type.
                                                                                           @type {number} */ (record.readAttribute(scope))
    const newScopeValue = scopeChanged ? /**
                                          * Narrows the runtime value to the documented type.
                                           @type {number} */ (changes[scopeCol]) : /**
                                                                                    * Narrows the runtime value to the documented type.
                                                                                     @type {number} */ (record.readAttribute(scope))

    if (oldPosition == null || newPosition == null) return
    if (newPosition === oldPosition && newScopeValue === oldScopeValue) return

    // Move the record out of the way before shifting others to avoid
    // intermediate UNIQUE constraint violations. Use the old scope value
    // for the move-out-of-way because the record is still in the old scope.
    await moveOutOfWay({record, positionColumn, scope, scopeValue: oldScopeValue})
    setShiftingFlag(record, false)

    if (scopeChanged && oldScopeValue !== newScopeValue) {
      let targetPosition = newPosition

      // When only the scope changes without a new position, append to the end
      // of the new scope. There is no target-scope row to shift out of the way.
      if (!posChanged) {
        const highestNew = await highestPositionInScope({record, positionColumn, scope, scopeValue: newScopeValue})
        const nextPos = highestNew + 1

        record.setAttribute(positionColumn, nextPos)
        await shiftPositionsDown({record, positionColumn, scope, scopeValue: oldScopeValue, fromPosition: oldPosition + 1})
        return
      }

      await shiftPositionsDown({record, positionColumn, scope, scopeValue: oldScopeValue, fromPosition: oldPosition + 1})
      await shiftPositionsUp({record, positionColumn, scope, scopeValue: newScopeValue, fromPosition: targetPosition})
      return
    }

    if (newPosition < oldPosition) {
      await shiftPositionsUp({record, positionColumn, scope, fromPosition: newPosition, toPosition: oldPosition})
    } else if (newPosition > oldPosition) {
      await shiftPositionsDown({record, positionColumn, scope, fromPosition: oldPosition + 1, toPosition: newPosition + 1})
    }
  })

  modelClass.beforeDestroy(async (record) => {
    const position = record.readAttribute(positionColumn)

    if (position == null) return

    await moveOutOfWay({record, positionColumn, scope})
    setShiftingFlag(record, false)

    await shiftPositionsDown({record, positionColumn, scope, fromPosition: position + 1})
  })
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
 * @returns {Promise<void>}
 */
async function shiftPositionsUp({record, positionColumn, scope, fromPosition, toPosition, scopeValue}) {
  const modelClass = /**
                      * Narrows the runtime value to the documented type.
                       @type {typeof import("./index.js").default} */ (record.constructor)
  const connection = modelClass.connection()
  const tableName = modelClass._getTable().getName()
  const resolvedScopeValue = scopeValue != null ? scopeValue : resolveScopeValue(record, scope)
  const scopeUnderscore = inflection.underscore(scope)

  if (resolvedScopeValue == null) return

  const positionUnderscore = inflection.underscore(positionColumn)
  const positionColumnSql = connection.quoteColumn(positionUnderscore)
  const scopeColumnSql = connection.quoteColumn(scopeUnderscore)
  const tableSql = connection.quoteTable(tableName)
  const quotedScope = connection.quote(resolvedScopeValue)

  // Load rows in descending order so we bump the highest first
  let query = modelClass
    .select(positionColumn)
    .where({[scopeUnderscore]: resolvedScopeValue})
    .where(`${positionColumnSql} >= ${connection.quote(fromPosition)}`)
    .order(`${positionUnderscore} DESC`)

  if (toPosition != null) {
    query = query.where(`${positionColumnSql} < ${connection.quote(toPosition)}`)
  }

  const rows = await query.toArray()

  setShiftingFlag(record, true)

  try {
    for (const row of rows) {
      const currentPos = Number(row.readAttribute(positionColumn))

      await connection.query(
        `UPDATE ${tableSql} SET ${positionColumnSql} = ${positionColumnSql} + 1 WHERE ${scopeColumnSql} = ${quotedScope} AND ${positionColumnSql} = ${connection.quote(currentPos)}`
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
  const modelClass = /**
                      * Narrows the runtime value to the documented type.
                       @type {typeof import("./index.js").default} */ (record.constructor)
  const connection = modelClass.connection()
  const tableName = modelClass._getTable().getName()
  const resolvedScopeValue = scopeValue != null ? scopeValue : resolveScopeValue(record, scope)
  const scopeUnderscore = inflection.underscore(scope)

  if (resolvedScopeValue == null) return

  const positionUnderscore = inflection.underscore(positionColumn)
  const positionColumnSql = connection.quoteColumn(positionUnderscore)
  const scopeColumnSql = connection.quoteColumn(scopeUnderscore)
  const tableSql = connection.quoteTable(tableName)
  const quotedScope = connection.quote(resolvedScopeValue)

  // Load rows in ascending order so we shift the lowest gap first
  let query = modelClass
    .select(positionColumn)
    .where({[scopeUnderscore]: resolvedScopeValue})
    .where(`${positionColumnSql} >= ${connection.quote(fromPosition)}`)
    .order(positionUnderscore)

  if (toPosition != null) {
    query = query.where(`${positionColumnSql} < ${connection.quote(toPosition)}`)
  }

  const rows = await query.toArray()

  setShiftingFlag(record, true)

  try {
    for (const row of rows) {
      const currentPos = Number(row.readAttribute(positionColumn))

      await connection.query(
        `UPDATE ${tableSql} SET ${positionColumnSql} = ${positionColumnSql} - 1 WHERE ${scopeColumnSql} = ${quotedScope} AND ${positionColumnSql} = ${connection.quote(currentPos)}`
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
  const modelClass = /**
                      * Narrows the runtime value to the documented type.
                       @type {typeof import("./index.js").default} */ (record.constructor)
  const scopeUnderscore = inflection.underscore(scope)
  const resolvedScopeValue = scopeValue != null ? scopeValue : resolveScopeValue(record, scope)

  if (resolvedScopeValue == null) return 0

  const rows = await modelClass
    .select(positionColumn)
    .where({[scopeUnderscore]: resolvedScopeValue})
    .order(`${positionColumn} DESC`)
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
 * @returns {string | number | null}
 */
function resolveScopeValue(record, scope) {
  const attrValue = record.readAttribute(scope)

  if (attrValue != null) return /** Narrows the runtime value to the documented type. @type {string | number} */ (attrValue)

  const modelClass = /**
                      * Narrows the runtime value to the documented type.
                       @type {typeof import("./index.js").default} */ (record.constructor)
  const relationships = modelClass.getRelationshipsMap()

  for (const relationshipName in relationships) {
    const relationship = relationships[relationshipName]

    if (relationship.getType?.() !== "belongsTo") continue

    const foreignKey = inflection.camelize(relationship.getForeignKey(), true)

    if (foreignKey !== scope) continue

    const instanceRelationship = record.getRelationshipByName(relationshipName)
    const loaded = instanceRelationship.loaded()

    if (loaded && !Array.isArray(loaded) && typeof loaded.id === "function") {
      return loaded.id()
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
 * @param {string | number | null} [args.scopeValue] - Explicit scope value (defaults to resolveScopeValue).
 * @returns {Promise<void>}
 */
async function moveOutOfWay({record, positionColumn, scope, scopeValue}) {
  const modelClass = /**
                      * Narrows the runtime value to the documented type.
                       @type {typeof import("./index.js").default} */ (record.constructor)
  const connection = modelClass.connection()
  const tableName = modelClass._getTable().getName()
  const resolvedScopeValue = scopeValue != null ? scopeValue : resolveScopeValue(record, scope)

  if (resolvedScopeValue == null) return

  const highest = await highestPositionInScope({record, positionColumn, scope, scopeValue: resolvedScopeValue})
  const tempPosition = highest + 10000
  const positionColumnSql = connection.quoteColumn(inflection.underscore(positionColumn))
  const scopeColumnSql = connection.quoteColumn(inflection.underscore(scope))
  const tableSql = connection.quoteTable(tableName)
  const pkSql = connection.quoteColumn("id")

  setShiftingFlag(record, true)

  try {
    await connection.query(
      `UPDATE ${tableSql} SET ${positionColumnSql} = ${connection.quote(tempPosition)} WHERE ${scopeColumnSql} = ${connection.quote(resolvedScopeValue)} AND ${pkSql} = ${connection.quote(record.id())}`
    )
  } finally {
    // Don't clear the flag here — the caller will do that after shifts
  }
}
