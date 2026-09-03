// @ts-check
import { scalarModelPrimaryKey, scalarModelPrimaryKeyValue } from "../../utils/model-primary-key.js";
/** @file Registers gap-less positional list callbacks on a model class. */
/**
 * Acts as list shifting.
 * @type {symbol} - Guard flag set on the model instance during shift operations to prevent re-entrant lifecycle hooks.
 */
const ACTS_AS_LIST_SHIFTING = Symbol("actsAsListShifting");
/**
 * Returns the scalar primary-key column required by acts-as-list SQL.
 * @param {typeof import("./index.js").default} modelClass - List model class.
 * @returns {string} - Scalar primary-key column.
 */
function actsAsListPrimaryKey(modelClass) {
    return scalarModelPrimaryKey(modelClass.primaryKey(), `actsAsList for ${modelClass.name}`);
}
/**
 * Returns the scalar record id required by acts-as-list SQL.
 * @param {import("./index.js").default} record - List record.
 * @returns {string | number} - Scalar record id.
 */
function actsAsListRecordId(record) {
    return scalarModelPrimaryKeyValue(record.id(), `actsAsList for ${record.getModelClass().name}`);
}
/**
 * Runs set shifting flag.
 * @param {import("./index.js").default} record - Model instance.
 * @param {boolean} value - Flag value.
 */
function setShiftingFlag(record, value) {
    // @ts-ignore - Symbol indexing on Record instances
    record[ACTS_AS_LIST_SHIFTING] = value;
}
/**
 * Runs is shifting.
 * @param {import("./index.js").default} record - Model instance.
 * @returns {boolean} - Whether list positions are currently shifting.
 */
function isShifting(record) {
    // @ts-ignore - Symbol indexing on Record instances
    return Boolean(record[ACTS_AS_LIST_SHIFTING]);
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
export default function registerActsAsListCallbacks(modelClass, positionColumn, { scope }) {
    modelClass.beforeCreate(async (record) => {
        if (isShifting(record))
            return;
        const position = record.readAttribute(positionColumn);
        if (position != null) {
            assertPositivePosition({ position, positionColumn });
            await shiftPositionsUp({ record, positionColumn, scope, fromPosition: position });
        }
        else {
            const nextPosition = await highestPositionInScope({ record, positionColumn, scope });
            record.setAttribute(positionColumn, nextPosition + 1);
        }
    });
    modelClass.beforeUpdate(async (record) => {
        if (isShifting(record))
            return;
        if (!record.isPersisted())
            return;
        const modelClass = /** @type {typeof import("./index.js").default} */ (record.constructor);
        const posColumn = modelClass.getColumnNameForAttributeName(positionColumn);
        const scopeCol = modelClass.getColumnNameForAttributeName(scope);
        /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const rawAttributes = record._attributes || {};
        /** @type {Record<string, ReturnType<typeof JSON.parse>>} */
        const changes = record._changes || {};
        /** @type {Set<string>} */
        const assignedAttributeNames = record._assignedAttributeNames || new Set();
        const posChanged = posColumn in changes;
        const scopeChanged = scopeCol in changes;
        const posAssigned = assignedAttributeNames.has(positionColumn);
        if (!posChanged && !scopeChanged)
            return;
        assertPositivePosition({
            position: rawAttributes[posColumn],
            positionColumn,
            persisted: true
        });
        const oldPosition = posChanged ? /** @type {number} */ (rawAttributes[posColumn]) : /** @type {number} */ (record.readAttribute(positionColumn));
        const newPosition = posChanged ? /** @type {number} */ (changes[posColumn]) : /** @type {number} */ (record.readAttribute(positionColumn));
        const oldScopeValue = scopeChanged ? /** @type {number} */ (rawAttributes[scopeCol]) : /** @type {number} */ (record.readAttribute(scope));
        const newScopeValue = scopeChanged ? /** @type {number} */ (changes[scopeCol]) : /** @type {number} */ (record.readAttribute(scope));
        assertPositivePosition({ position: newPosition, positionColumn });
        if (oldPosition == null)
            return;
        if (newPosition === oldPosition && newScopeValue === oldScopeValue)
            return;
        if (scopeChanged && oldScopeValue !== newScopeValue) {
            // When only the scope changes without a new position, append to the end
            // of the new scope. There is no target-scope row to shift out of the way.
            if (!posAssigned) {
                await moveOutOfWay({ record, positionColumn, scope, scopeValue: oldScopeValue });
                setShiftingFlag(record, false);
                const highestNew = await highestPositionInScope({ record, positionColumn, scope, scopeValue: newScopeValue });
                const nextPos = highestNew + 1;
                record.setAttribute(positionColumn, nextPos);
                await shiftPositionsDown({ record, positionColumn, scope, scopeValue: oldScopeValue, fromPosition: oldPosition + 1 });
                return;
            }
            await moveOutOfWay({ record, positionColumn, scope, scopeValue: oldScopeValue });
            setShiftingFlag(record, false);
            await shiftPositionsDown({ record, positionColumn, scope, scopeValue: oldScopeValue, fromPosition: oldPosition + 1 });
            await shiftPositionsUp({ record, positionColumn, scope, scopeValue: newScopeValue, fromPosition: newPosition, excludeRecordId: actsAsListRecordId(record) });
            await placeMovedRecord({ record, positionColumn, scope, scopeValue: newScopeValue, position: newPosition });
            return;
        }
        await moveOutOfWay({ record, positionColumn, scope, scopeValue: oldScopeValue });
        setShiftingFlag(record, false);
        if (newPosition < oldPosition) {
            await shiftPositionsUp({ record, positionColumn, scope, fromPosition: newPosition, toPosition: oldPosition });
        }
        else if (newPosition > oldPosition) {
            await shiftPositionsDown({ record, positionColumn, scope, fromPosition: oldPosition + 1, toPosition: newPosition + 1 });
        }
    });
    modelClass.beforeDestroy(async (record) => {
        const position = record.readAttribute(positionColumn);
        if (position == null) {
            const modelClass = /** @type {typeof import("./index.js").default} */ (record.constructor);
            const posColumn = modelClass.getColumnNameForAttributeName(positionColumn);
            if (posColumn in record._attributes)
                assertPositivePosition({ position, positionColumn, persisted: true });
            return;
        }
        assertPositivePosition({ position, positionColumn, persisted: true });
        await moveOutOfWay({ record, positionColumn, scope });
        setShiftingFlag(record, false);
        await shiftPositionsDown({ record, positionColumn, scope, fromPosition: position + 1 });
    });
}
/**
 * Enforces the public gap-less list position invariant before any shifting.
 * @param {object} args - Arguments.
 * @param {number | null | undefined} args.position - Position to validate.
 * @param {string} args.positionColumn - Position attribute name.
 * @param {boolean} [args.persisted] - Whether the invalid value came from persisted state.
 * @returns {void}
 */
function assertPositivePosition({ position, positionColumn, persisted = false }) {
    if (typeof position === "number" && Number.isInteger(position) && position > 0)
        return;
    const source = persisted ? "Persisted" : "Requested";
    throw new Error(`${source} actsAsList ${positionColumn} must be a positive integer`);
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
async function placeMovedRecord({ record, positionColumn, scope, scopeValue, position }) {
    const modelClass = /** @type {typeof import("./index.js").default} */ (record.constructor);
    const connection = record.connection();
    const tableSql = connection.quoteTable(modelClass._getTable().getName());
    const scopeCol = modelClass.getColumnNameForAttributeName(scope);
    const posCol = modelClass.getColumnNameForAttributeName(positionColumn);
    const preservedChanges = { ...record._changes };
    const scopeColumnSql = connection.quoteColumn(scopeCol);
    const positionColumnSql = connection.quoteColumn(posCol);
    const primaryKey = actsAsListPrimaryKey(modelClass);
    const primaryKeySql = connection.quoteColumn(primaryKey);
    const recordId = actsAsListRecordId(record);
    delete preservedChanges[scopeCol];
    delete preservedChanges[posCol];
    await connection.query(`UPDATE ${tableSql} SET ${scopeColumnSql} = ${connection.quote(scopeValue)}, ${positionColumnSql} = ${connection.quote(position)} WHERE ${primaryKeySql} = ${connection.quote(recordId)}`);
    await record._reloadWithId(recordId);
    record._changes = preservedChanges;
    clearBelongsToChangeForScope(record);
}
/**
 * Clears dirty belongs-to state for the scope FK after direct placement.
 * @param {import("./index.js").default} record - Model instance.
 * @returns {void} Nothing.
 */
function clearBelongsToChangeForScope(record) {
    for (const relationshipName in record._instanceRelationships || {}) {
        const relationship = record._instanceRelationships[relationshipName];
        if (relationship.getType() !== "belongsTo")
            continue;
        relationship.setDirty(false);
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
async function shiftPositionsUp({ record, positionColumn, scope, fromPosition, toPosition, scopeValue, excludeRecordId }) {
    const modelClass = /** @type {typeof import("./index.js").default} */ (record.constructor);
    const connection = record.connection();
    const tableName = modelClass._getTable().getName();
    const resolvedScopeValue = scopeValue != null ? scopeValue : resolveScopeValue(record, scope);
    const scopeColumnName = modelClass.getColumnNameForAttributeName(scope);
    if (resolvedScopeValue == null)
        return;
    const positionColumnName = modelClass.getColumnNameForAttributeName(positionColumn);
    const positionColumnSql = connection.quoteColumn(positionColumnName);
    const scopeColumnSql = connection.quoteColumn(scopeColumnName);
    const primaryKey = actsAsListPrimaryKey(modelClass);
    const primaryKeySql = connection.quoteColumn(primaryKey);
    const tableSql = connection.quoteTable(tableName);
    const quotedScope = connection.quote(resolvedScopeValue);
    // Load rows in descending order so we bump the highest first
    let query = record
        .queryForModel(modelClass)
        .select(primaryKey)
        .select(positionColumn)
        .where({ [scopeColumnName]: resolvedScopeValue })
        .where(`${positionColumnSql} >= ${connection.quote(fromPosition)}`)
        .where(`${positionColumnSql} > 0`)
        .order(`${positionColumnSql} DESC`);
    const recordIdToExclude = excludeRecordId || (record.isPersisted() ? actsAsListRecordId(record) : null);
    if (recordIdToExclude != null) {
        query = query.where(`${primaryKeySql} != ${connection.quote(recordIdToExclude)}`);
    }
    if (toPosition != null) {
        query = query.where(`${positionColumnSql} < ${connection.quote(toPosition)}`);
    }
    const rows = await query.toArray();
    setShiftingFlag(record, true);
    try {
        for (const row of rows) {
            const currentPos = Number(row.readAttribute(positionColumn));
            await connection.query(`UPDATE ${tableSql} SET ${positionColumnSql} = ${positionColumnSql} + 1 WHERE ${primaryKeySql} = ${connection.quote(row.id())} AND ${scopeColumnSql} = ${quotedScope} AND ${positionColumnSql} = ${connection.quote(currentPos)}`);
        }
    }
    finally {
        setShiftingFlag(record, false);
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
async function shiftPositionsDown({ record, positionColumn, scope, fromPosition, toPosition, scopeValue }) {
    const modelClass = /** @type {typeof import("./index.js").default} */ (record.constructor);
    const connection = record.connection();
    const tableName = modelClass._getTable().getName();
    const resolvedScopeValue = scopeValue != null ? scopeValue : resolveScopeValue(record, scope);
    const scopeColumnName = modelClass.getColumnNameForAttributeName(scope);
    if (resolvedScopeValue == null)
        return;
    const positionColumnName = modelClass.getColumnNameForAttributeName(positionColumn);
    const positionColumnSql = connection.quoteColumn(positionColumnName);
    const scopeColumnSql = connection.quoteColumn(scopeColumnName);
    const primaryKey = actsAsListPrimaryKey(modelClass);
    const primaryKeySql = connection.quoteColumn(primaryKey);
    const tableSql = connection.quoteTable(tableName);
    const quotedScope = connection.quote(resolvedScopeValue);
    // Load rows in ascending order so we shift the lowest gap first
    let query = record
        .queryForModel(modelClass)
        .select(primaryKey)
        .select(positionColumn)
        .where({ [scopeColumnName]: resolvedScopeValue })
        .where(`${positionColumnSql} >= ${connection.quote(fromPosition)}`)
        .where(`${positionColumnSql} > 0`)
        .where(`${primaryKeySql} != ${connection.quote(actsAsListRecordId(record))}`)
        .order({ column: positionColumnName, direction: "ASC" });
    if (toPosition != null) {
        query = query.where(`${positionColumnSql} < ${connection.quote(toPosition)}`);
    }
    const rows = await query.toArray();
    setShiftingFlag(record, true);
    try {
        for (const row of rows) {
            const currentPos = Number(row.readAttribute(positionColumn));
            await connection.query(`UPDATE ${tableSql} SET ${positionColumnSql} = ${positionColumnSql} - 1 WHERE ${primaryKeySql} = ${connection.quote(row.id())} AND ${scopeColumnSql} = ${quotedScope} AND ${positionColumnSql} = ${connection.quote(currentPos)}`);
        }
    }
    finally {
        setShiftingFlag(record, false);
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
async function highestPositionInScope({ record, positionColumn, scope, scopeValue }) {
    const modelClass = /** @type {typeof import("./index.js").default} */ (record.constructor);
    const connection = record.connection();
    const scopeColumnName = modelClass.getColumnNameForAttributeName(scope);
    const positionColumnName = modelClass.getColumnNameForAttributeName(positionColumn);
    const positionColumnSql = connection.quoteColumn(positionColumnName);
    const resolvedScopeValue = scopeValue != null ? scopeValue : resolveScopeValue(record, scope);
    if (resolvedScopeValue == null)
        return 0;
    const rows = await record
        .queryForModel(modelClass)
        .select(positionColumn)
        .where({ [scopeColumnName]: resolvedScopeValue })
        .order(`${positionColumnSql} DESC`)
        .limit(1)
        .toArray();
    if (rows.length === 0)
        return 0;
    return Number(rows[0].readAttribute(positionColumn)) || 0;
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
    const attrValue = record.readAttribute(scope);
    if (attrValue != null)
        return /** @type {string | number} */ (attrValue);
    const modelClass = /** @type {typeof import("./index.js").default} */ (record.constructor);
    const relationships = modelClass.getRelationshipsMap();
    const scopeColumnName = modelClass.getColumnNameForAttributeName(scope);
    for (const relationshipName in relationships) {
        const relationship = relationships[relationshipName];
        if (relationship.getType?.() !== "belongsTo")
            continue;
        const foreignKey = relationship.getForeignKey();
        if (foreignKey !== scopeColumnName)
            continue;
        const instanceRelationship = record.getRelationshipByName(relationshipName);
        const loaded = instanceRelationship.loaded();
        if (loaded && !Array.isArray(loaded) && typeof loaded.id === "function") {
            return scalarModelPrimaryKeyValue(loaded.id(), `actsAsList scope relationship for ${modelClass.name}`);
        }
    }
    return null;
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
async function moveOutOfWay({ record, positionColumn, scope, scopeValue }) {
    const modelClass = /** @type {typeof import("./index.js").default} */ (record.constructor);
    const connection = record.connection();
    const tableName = modelClass._getTable().getName();
    const resolvedScopeValue = scopeValue != null ? scopeValue : resolveScopeValue(record, scope);
    if (resolvedScopeValue == null)
        return;
    const positionColumnSql = connection.quoteColumn(modelClass.getColumnNameForAttributeName(positionColumn));
    const scopeColumnSql = connection.quoteColumn(modelClass.getColumnNameForAttributeName(scope));
    const tableSql = connection.quoteTable(tableName);
    const pkSql = connection.quoteColumn(actsAsListPrimaryKey(modelClass));
    setShiftingFlag(record, true);
    try {
        await connection.query(`UPDATE ${tableSql} SET ${positionColumnSql} = -${positionColumnSql} WHERE ${scopeColumnSql} = ${connection.quote(resolvedScopeValue)} AND ${pkSql} = ${connection.quote(actsAsListRecordId(record))}`);
    }
    finally {
        // Don't clear the flag here — the caller will do that after shifts
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWN0cy1hcy1saXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL3JlY29yZC9hY3RzLWFzLWxpc3QuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBQyxxQkFBcUIsRUFBRSwwQkFBMEIsRUFBQyxNQUFNLGtDQUFrQyxDQUFBO0FBRWxHLDJFQUEyRTtBQUUzRTs7O0dBR0c7QUFDSCxNQUFNLHFCQUFxQixHQUFHLE1BQU0sQ0FBQyxvQkFBb0IsQ0FBQyxDQUFBO0FBRTFEOzs7O0dBSUc7QUFDSCxTQUFTLG9CQUFvQixDQUFDLFVBQVU7SUFDdEMsT0FBTyxxQkFBcUIsQ0FBQyxVQUFVLENBQUMsVUFBVSxFQUFFLEVBQUUsa0JBQWtCLFVBQVUsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFBO0FBQzVGLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBUyxrQkFBa0IsQ0FBQyxNQUFNO0lBQ2hDLE9BQU8sMEJBQTBCLENBQUMsTUFBTSxDQUFDLEVBQUUsRUFBRSxFQUFFLGtCQUFrQixNQUFNLENBQUMsYUFBYSxFQUFFLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQTtBQUNqRyxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsZUFBZSxDQUFDLE1BQU0sRUFBRSxLQUFLO0lBQ3BDLG1EQUFtRDtJQUNuRCxNQUFNLENBQUMscUJBQXFCLENBQUMsR0FBRyxLQUFLLENBQUE7QUFDdkMsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLFVBQVUsQ0FBQyxNQUFNO0lBQ3hCLG1EQUFtRDtJQUNuRCxPQUFPLE9BQU8sQ0FBQyxNQUFNLENBQUMscUJBQXFCLENBQUMsQ0FBQyxDQUFBO0FBQy9DLENBQUM7QUFFRDs7Ozs7Ozs7Ozs7Ozs7R0FjRztBQUNILE1BQU0sQ0FBQyxPQUFPLFVBQVUsMkJBQTJCLENBQUMsVUFBVSxFQUFFLGNBQWMsRUFBRSxFQUFDLEtBQUssRUFBQztJQUNyRixV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V0FBVyxDQUFDLFVBQVUsQ0FBQyw2QkFBNkIsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFBO0lBQzlGLE1BQU0sUUFBUSxHQUFHLFVBQVUsQ0FBQyxVQUFVLENBQUMsU0FBUyxDQUFDLENBQUE7SUFDakQsTUFBTSxLQUFLLEdBQUcsVUFBVSxDQUFDLFdBQVcsQ0FBQyxvQkFBb0IsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFBO0lBRXRFLGVBQWUsQ0FBQyxNQUFNLEVBQUUsSUFBSSxDQUFDLENBQUE7SUFFN0IsSUFBSSxDQUFDO1FBQ0gsTUFBTSxVQUFVLENBQUMsS0FBSyxDQUNwQixVQUFVLFFBQVEsUUFBUSxpQkFBaUIsT0FBTyxpQkFBaUIsVUFBVSxjQUFjLE1BQU0sVUFBVSxDQUFDLEtBQUssQ0FBQyxrQkFBa0IsQ0FBQyxRQUFRLEtBQUssTUFBTSxVQUFVLENBQUMsS0FBSyxDQUFDLGtCQUFrQixDQUFDLE1BQU0sQ0FBQyxDQUFDLEVBQUUsQ0FDdk0sQ0FBQTtJQUNILENBQUM7WUFBUyxDQUFDO1FBQ1QsbUVBQW1FO0lBQ3JFLENBQUM7QUFDSCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCB7c2NhbGFyTW9kZWxQcmltYXJ5S2V5LCBzY2FsYXJNb2RlbFByaW1hcnlLZXlWYWx1ZX0gZnJvbSBcIi4uLy4uL3V0aWxzL21vZGVsLXByaW1hcnkta2V5LmpzXCJcblxuLyoqIEBmaWxlIFJlZ2lzdGVycyBnYXAtbGVzcyBwb3NpdGlvbmFsIGxpc3QgY2FsbGJhY2tzIG9uIGEgbW9kZWwgY2xhc3MuICovXG5cbi8qKlxuICogQWN0cyBhcyBsaXN0IHNoaWZ0aW5nLlxuICogQHR5cGUge3N5bWJvbH0gLSBHdWFyZCBmbGFnIHNldCBvbiB0aGUgbW9kZWwgaW5zdGFuY2UgZHVyaW5nIHNoaWZ0IG9wZXJhdGlvbnMgdG8gcHJldmVudCByZS1lbnRyYW50IGxpZmVjeWNsZSBob29rcy5cbiAqL1xuY29uc3QgQUNUU19BU19MSVNUX1NISUZUSU5HID0gU3ltYm9sKFwiYWN0c0FzTGlzdFNoaWZ0aW5nXCIpXG5cbi8qKlxuICogUmV0dXJucyB0aGUgc2NhbGFyIHByaW1hcnkta2V5IGNvbHVtbiByZXF1aXJlZCBieSBhY3RzLWFzLWxpc3QgU1FMLlxuICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gTGlzdCBtb2RlbCBjbGFzcy5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU2NhbGFyIHByaW1hcnkta2V5IGNvbHVtbi5cbiAqL1xuZnVuY3Rpb24gYWN0c0FzTGlzdFByaW1hcnlLZXkobW9kZWxDbGFzcykge1xuICByZXR1cm4gc2NhbGFyTW9kZWxQcmltYXJ5S2V5KG1vZGVsQ2xhc3MucHJpbWFyeUtleSgpLCBgYWN0c0FzTGlzdCBmb3IgJHttb2RlbENsYXNzLm5hbWV9YClcbn1cblxuLyoqXG4gKiBSZXR1cm5zIHRoZSBzY2FsYXIgcmVjb3JkIGlkIHJlcXVpcmVkIGJ5IGFjdHMtYXMtbGlzdCBTUUwuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gcmVjb3JkIC0gTGlzdCByZWNvcmQuXG4gKiBAcmV0dXJucyB7c3RyaW5nIHwgbnVtYmVyfSAtIFNjYWxhciByZWNvcmQgaWQuXG4gKi9cbmZ1bmN0aW9uIGFjdHNBc0xpc3RSZWNvcmRJZChyZWNvcmQpIHtcbiAgcmV0dXJuIHNjYWxhck1vZGVsUHJpbWFyeUtleVZhbHVlKHJlY29yZC5pZCgpLCBgYWN0c0FzTGlzdCBmb3IgJHtyZWNvcmQuZ2V0TW9kZWxDbGFzcygpLm5hbWV9YClcbn1cblxuLyoqXG4gKiBSdW5zIHNldCBzaGlmdGluZyBmbGFnLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IHJlY29yZCAtIE1vZGVsIGluc3RhbmNlLlxuICogQHBhcmFtIHtib29sZWFufSB2YWx1ZSAtIEZsYWcgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIHNldFNoaWZ0aW5nRmxhZyhyZWNvcmQsIHZhbHVlKSB7XG4gIC8vIEB0cy1pZ25vcmUgLSBTeW1ib2wgaW5kZXhpbmcgb24gUmVjb3JkIGluc3RhbmNlc1xuICByZWNvcmRbQUNUU19BU19MSVNUX1NISUZUSU5HXSA9IHZhbHVlXG59XG5cbi8qKlxuICogUnVucyBpcyBzaGlmdGluZy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSByZWNvcmQgLSBNb2RlbCBpbnN0YW5jZS5cbiAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgbGlzdCBwb3NpdGlvbnMgYXJlIGN1cnJlbnRseSBzaGlmdGluZy5cbiAqL1xuZnVuY3Rpb24gaXNTaGlmdGluZyhyZWNvcmQpIHtcbiAgLy8gQHRzLWlnbm9yZSAtIFN5bWJvbCBpbmRleGluZyBvbiBSZWNvcmQgaW5zdGFuY2VzXG4gIHJldHVybiBCb29sZWFuKHJlY29yZFtBQ1RTX0FTX0xJU1RfU0hJRlRJTkddKVxufVxuXG4vKipcbiAqIFJlZ2lzdGVycyBnYXAtbGVzcyBwb3NpdGlvbmFsIGxpc3QgY2FsbGJhY2tzIG9uIGEgbW9kZWwgY2xhc3MgdG8gbWFpbnRhaW5cbiAqIGEgZ2FwLWxlc3MgcG9zaXRpb25hbCBsaXN0LiBXaGVuIGEgcmVjb3JkIGlzIGluc2VydGVkLCB1cGRhdGVkLCBvclxuICogZGVzdHJveWVkLCB0aGUgc3Vycm91bmRpbmcgcG9zaXRpb25zIGFyZSBzaGlmdGVkIHNvIHRoZSBsaXN0IHN0YXlzIGNvbXBhY3RcbiAqICgxLDIsMywuLi4pIGFuZCBzY29wZWQgd2l0aGluIHRoZSBnaXZlbiBjb2x1bW4uXG4gKlxuICogQ2FsbGVycyBtdXN0IGFsc28gZW5zdXJlIGEgVU5JUVVFIGluZGV4IG9uIChzY29wZUNvbHVtbiwgcG9zaXRpb25Db2x1bW4pXG4gKiBleGlzdHMgaW4gdGhlIGRhdGFiYXNlIHNjaGVtYSDigJQgdXNlIGBNaWdyYXRpb24uYWRkQWN0c0FzTGlzdCgpYCBmb3IgdGhlXG4gKiBjb3JyZXNwb25kaW5nIHNjaGVtYSBzZXR1cC5cbiAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIFRoZSBtb2RlbCBjbGFzcy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBwb3NpdGlvbkNvbHVtbiAtIGNhbWVsQ2FzZSBuYW1lIG9mIHRoZSBwb3NpdGlvbiBhdHRyaWJ1dGUgKGUuZy4gXCJyb3dOdW1iZXJcIikuXG4gKiBAcGFyYW0ge29iamVjdH0gb3B0aW9ucyAtIE9wdGlvbnMuXG4gKiBAcGFyYW0ge3N0cmluZ30gb3B0aW9ucy5zY29wZSAtIGNhbWVsQ2FzZSBuYW1lIG9mIHRoZSBzY29wZSBhdHRyaWJ1dGUgKGUuZy4gXCJib2FyZENvbHVtbklkXCIpLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmV4cG9ydCBkZWZhdWx0IGZ1bmN0aW9uIHJlZ2lzdGVyQWN0c0FzTGlzdENhbGxiYWNrcyhtb2RlbENsYXNzLCBwb3NpdGlvbkNvbHVtbiwge3Njb3BlfSkge1xuICBtb2RlbENsYXNzLmJlZm9yZUNyZWF0ZShhc3luYyAocmVjb3JkKSA9PiB7XG4gICAgaWYgKGlzU2hpZnRpbmcocmVjb3JkKSkgcmV0dXJuXG5cbiAgICBjb25zdCBwb3NpdGlvbiA9IHJlY29yZC5yZWFkQXR0cmlidXRlKHBvc2l0aW9uQ29sdW1uKVxuXG4gICAgaWYgKHBvc2l0aW9uICE9IG51bGwpIHtcbiAgICAgIGFzc2VydFBvc2l0aXZlUG9zaXRpb24oe3Bvc2l0aW9uLCBwb3NpdGlvbkNvbHVtbn0pXG4gICAgICBhd2FpdCBzaGlmdFBvc2l0aW9uc1VwKHtyZWNvcmQsIHBvc2l0aW9uQ29sdW1uLCBzY29wZSwgZnJvbVBvc2l0aW9uOiBwb3NpdGlvbn0pXG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IG5leHRQb3NpdGlvbiA9IGF3YWl0IGhpZ2hlc3RQb3NpdGlvbkluU2NvcGUoe3JlY29yZCwgcG9zaXRpb25Db2x1bW4sIHNjb3BlfSlcblxuICAgICAgcmVjb3JkLnNldEF0dHJpYnV0ZShwb3NpdGlvbkNvbHVtbiwgbmV4dFBvc2l0aW9uICsgMSlcbiAgICB9XG4gIH0pXG5cbiAgbW9kZWxDbGFzcy5iZWZvcmVVcGRhdGUoYXN5bmMgKHJlY29yZCkgPT4ge1xuICAgIGlmIChpc1NoaWZ0aW5nKHJlY29yZCkpIHJldHVyblxuICAgIGlmICghcmVjb3JkLmlzUGVyc2lzdGVkKCkpIHJldHVyblxuXG4gICAgY29uc3QgbW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIGltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gKi8gKHJlY29yZC5jb25zdHJ1Y3RvcilcbiAgICBjb25zdCBwb3NDb2x1bW4gPSBtb2RlbENsYXNzLmdldENvbHVtbk5hbWVGb3JBdHRyaWJ1dGVOYW1lKHBvc2l0aW9uQ29sdW1uKVxuICAgIGNvbnN0IHNjb3BlQ29sID0gbW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lRm9yQXR0cmlidXRlTmFtZShzY29wZSlcbiAgICAvKiogQHR5cGUge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gKi9cbiAgICBjb25zdCByYXdBdHRyaWJ1dGVzID0gcmVjb3JkLl9hdHRyaWJ1dGVzIHx8IHt9XG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgY2hhbmdlcyA9IHJlY29yZC5fY2hhbmdlcyB8fCB7fVxuICAgIC8qKiBAdHlwZSB7U2V0PHN0cmluZz59ICovXG4gICAgY29uc3QgYXNzaWduZWRBdHRyaWJ1dGVOYW1lcyA9IHJlY29yZC5fYXNzaWduZWRBdHRyaWJ1dGVOYW1lcyB8fCBuZXcgU2V0KClcbiAgICBjb25zdCBwb3NDaGFuZ2VkID0gcG9zQ29sdW1uIGluIGNoYW5nZXNcbiAgICBjb25zdCBzY29wZUNoYW5nZWQgPSBzY29wZUNvbCBpbiBjaGFuZ2VzXG4gICAgY29uc3QgcG9zQXNzaWduZWQgPSBhc3NpZ25lZEF0dHJpYnV0ZU5hbWVzLmhhcyhwb3NpdGlvbkNvbHVtbilcblxuICAgIGlmICghcG9zQ2hhbmdlZCAmJiAhc2NvcGVDaGFuZ2VkKSByZXR1cm5cblxuICAgIGFzc2VydFBvc2l0aXZlUG9zaXRpb24oe1xuICAgICAgcG9zaXRpb246IHJhd0F0dHJpYnV0ZXNbcG9zQ29sdW1uXSxcbiAgICAgIHBvc2l0aW9uQ29sdW1uLFxuICAgICAgcGVyc2lzdGVkOiB0cnVlXG4gICAgfSlcblxuICAgIGNvbnN0IG9sZFBvc2l0aW9uID0gcG9zQ2hhbmdlZCA/IC8qKiBAdHlwZSB7bnVtYmVyfSAqLyAocmF3QXR0cmlidXRlc1twb3NDb2x1bW5dKSA6IC8qKiBAdHlwZSB7bnVtYmVyfSAqLyAocmVjb3JkLnJlYWRBdHRyaWJ1dGUocG9zaXRpb25Db2x1bW4pKVxuICAgIGNvbnN0IG5ld1Bvc2l0aW9uID0gcG9zQ2hhbmdlZCA/IC8qKiBAdHlwZSB7bnVtYmVyfSAqLyAoY2hhbmdlc1twb3NDb2x1bW5dKSA6IC8qKiBAdHlwZSB7bnVtYmVyfSAqLyAocmVjb3JkLnJlYWRBdHRyaWJ1dGUocG9zaXRpb25Db2x1bW4pKVxuICAgIGNvbnN0IG9sZFNjb3BlVmFsdWUgPSBzY29wZUNoYW5nZWQgPyAvKiogQHR5cGUge251bWJlcn0gKi8gKHJhd0F0dHJpYnV0ZXNbc2NvcGVDb2xdKSA6IC8qKiBAdHlwZSB7bnVtYmVyfSAqLyAocmVjb3JkLnJlYWRBdHRyaWJ1dGUoc2NvcGUpKVxuICAgIGNvbnN0IG5ld1Njb3BlVmFsdWUgPSBzY29wZUNoYW5nZWQgPyAvKiogQHR5cGUge251bWJlcn0gKi8gKGNoYW5nZXNbc2NvcGVDb2xdKSA6IC8qKiBAdHlwZSB7bnVtYmVyfSAqLyAocmVjb3JkLnJlYWRBdHRyaWJ1dGUoc2NvcGUpKVxuXG4gICAgYXNzZXJ0UG9zaXRpdmVQb3NpdGlvbih7cG9zaXRpb246IG5ld1Bvc2l0aW9uLCBwb3NpdGlvbkNvbHVtbn0pXG4gICAgaWYgKG9sZFBvc2l0aW9uID09IG51bGwpIHJldHVyblxuICAgIGlmIChuZXdQb3NpdGlvbiA9PT0gb2xkUG9zaXRpb24gJiYgbmV3U2NvcGVWYWx1ZSA9PT0gb2xkU2NvcGVWYWx1ZSkgcmV0dXJuXG5cbiAgICBpZiAoc2NvcGVDaGFuZ2VkICYmIG9sZFNjb3BlVmFsdWUgIT09IG5ld1Njb3BlVmFsdWUpIHtcbiAgICAgIC8vIFdoZW4gb25seSB0aGUgc2NvcGUgY2hhbmdlcyB3aXRob3V0IGEgbmV3IHBvc2l0aW9uLCBhcHBlbmQgdG8gdGhlIGVuZFxuICAgICAgLy8gb2YgdGhlIG5ldyBzY29wZS4gVGhlcmUgaXMgbm8gdGFyZ2V0LXNjb3BlIHJvdyB0byBzaGlmdCBvdXQgb2YgdGhlIHdheS5cbiAgICAgIGlmICghcG9zQXNzaWduZWQpIHtcbiAgICAgICAgYXdhaXQgbW92ZU91dE9mV2F5KHtyZWNvcmQsIHBvc2l0aW9uQ29sdW1uLCBzY29wZSwgc2NvcGVWYWx1ZTogb2xkU2NvcGVWYWx1ZX0pXG4gICAgICAgIHNldFNoaWZ0aW5nRmxhZyhyZWNvcmQsIGZhbHNlKVxuXG4gICAgICAgIGNvbnN0IGhpZ2hlc3ROZXcgPSBhd2FpdCBoaWdoZXN0UG9zaXRpb25JblNjb3BlKHtyZWNvcmQsIHBvc2l0aW9uQ29sdW1uLCBzY29wZSwgc2NvcGVWYWx1ZTogbmV3U2NvcGVWYWx1ZX0pXG4gICAgICAgIGNvbnN0IG5leHRQb3MgPSBoaWdoZXN0TmV3ICsgMVxuXG4gICAgICAgIHJlY29yZC5zZXRBdHRyaWJ1dGUocG9zaXRpb25Db2x1bW4sIG5leHRQb3MpXG4gICAgICAgIGF3YWl0IHNoaWZ0UG9zaXRpb25zRG93bih7cmVjb3JkLCBwb3NpdGlvbkNvbHVtbiwgc2NvcGUsIHNjb3BlVmFsdWU6IG9sZFNjb3BlVmFsdWUsIGZyb21Qb3NpdGlvbjogb2xkUG9zaXRpb24gKyAxfSlcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGF3YWl0IG1vdmVPdXRPZldheSh7cmVjb3JkLCBwb3NpdGlvbkNvbHVtbiwgc2NvcGUsIHNjb3BlVmFsdWU6IG9sZFNjb3BlVmFsdWV9KVxuICAgICAgc2V0U2hpZnRpbmdGbGFnKHJlY29yZCwgZmFsc2UpXG4gICAgICBhd2FpdCBzaGlmdFBvc2l0aW9uc0Rvd24oe3JlY29yZCwgcG9zaXRpb25Db2x1bW4sIHNjb3BlLCBzY29wZVZhbHVlOiBvbGRTY29wZVZhbHVlLCBmcm9tUG9zaXRpb246IG9sZFBvc2l0aW9uICsgMX0pXG4gICAgICBhd2FpdCBzaGlmdFBvc2l0aW9uc1VwKHtyZWNvcmQsIHBvc2l0aW9uQ29sdW1uLCBzY29wZSwgc2NvcGVWYWx1ZTogbmV3U2NvcGVWYWx1ZSwgZnJvbVBvc2l0aW9uOiBuZXdQb3NpdGlvbiwgZXhjbHVkZVJlY29yZElkOiBhY3RzQXNMaXN0UmVjb3JkSWQocmVjb3JkKX0pXG4gICAgICBhd2FpdCBwbGFjZU1vdmVkUmVjb3JkKHtyZWNvcmQsIHBvc2l0aW9uQ29sdW1uLCBzY29wZSwgc2NvcGVWYWx1ZTogbmV3U2NvcGVWYWx1ZSwgcG9zaXRpb246IG5ld1Bvc2l0aW9ufSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IG1vdmVPdXRPZldheSh7cmVjb3JkLCBwb3NpdGlvbkNvbHVtbiwgc2NvcGUsIHNjb3BlVmFsdWU6IG9sZFNjb3BlVmFsdWV9KVxuICAgIHNldFNoaWZ0aW5nRmxhZyhyZWNvcmQsIGZhbHNlKVxuXG4gICAgaWYgKG5ld1Bvc2l0aW9uIDwgb2xkUG9zaXRpb24pIHtcbiAgICAgIGF3YWl0IHNoaWZ0UG9zaXRpb25zVXAoe3JlY29yZCwgcG9zaXRpb25Db2x1bW4sIHNjb3BlLCBmcm9tUG9zaXRpb246IG5ld1Bvc2l0aW9uLCB0b1Bvc2l0aW9uOiBvbGRQb3NpdGlvbn0pXG4gICAgfSBlbHNlIGlmIChuZXdQb3NpdGlvbiA+IG9sZFBvc2l0aW9uKSB7XG4gICAgICBhd2FpdCBzaGlmdFBvc2l0aW9uc0Rvd24oe3JlY29yZCwgcG9zaXRpb25Db2x1bW4sIHNjb3BlLCBmcm9tUG9zaXRpb246IG9sZFBvc2l0aW9uICsgMSwgdG9Qb3NpdGlvbjogbmV3UG9zaXRpb24gKyAxfSlcbiAgICB9XG4gIH0pXG5cbiAgbW9kZWxDbGFzcy5iZWZvcmVEZXN0cm95KGFzeW5jIChyZWNvcmQpID0+IHtcbiAgICBjb25zdCBwb3NpdGlvbiA9IHJlY29yZC5yZWFkQXR0cmlidXRlKHBvc2l0aW9uQ29sdW1uKVxuXG4gICAgaWYgKHBvc2l0aW9uID09IG51bGwpIHtcbiAgICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9ICovIChyZWNvcmQuY29uc3RydWN0b3IpXG4gICAgICBjb25zdCBwb3NDb2x1bW4gPSBtb2RlbENsYXNzLmdldENvbHVtbk5hbWVGb3JBdHRyaWJ1dGVOYW1lKHBvc2l0aW9uQ29sdW1uKVxuXG4gICAgICBpZiAocG9zQ29sdW1uIGluIHJlY29yZC5fYXR0cmlidXRlcykgYXNzZXJ0UG9zaXRpdmVQb3NpdGlvbih7cG9zaXRpb24sIHBvc2l0aW9uQ29sdW1uLCBwZXJzaXN0ZWQ6IHRydWV9KVxuICAgICAgcmV0dXJuXG4gICAgfVxuICAgIGFzc2VydFBvc2l0aXZlUG9zaXRpb24oe3Bvc2l0aW9uLCBwb3NpdGlvbkNvbHVtbiwgcGVyc2lzdGVkOiB0cnVlfSlcblxuICAgIGF3YWl0IG1vdmVPdXRPZldheSh7cmVjb3JkLCBwb3NpdGlvbkNvbHVtbiwgc2NvcGV9KVxuICAgIHNldFNoaWZ0aW5nRmxhZyhyZWNvcmQsIGZhbHNlKVxuXG4gICAgYXdhaXQgc2hpZnRQb3NpdGlvbnNEb3duKHtyZWNvcmQsIHBvc2l0aW9uQ29sdW1uLCBzY29wZSwgZnJvbVBvc2l0aW9uOiBwb3NpdGlvbiArIDF9KVxuICB9KVxufVxuXG4vKipcbiAqIEVuZm9yY2VzIHRoZSBwdWJsaWMgZ2FwLWxlc3MgbGlzdCBwb3NpdGlvbiBpbnZhcmlhbnQgYmVmb3JlIGFueSBzaGlmdGluZy5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkfSBhcmdzLnBvc2l0aW9uIC0gUG9zaXRpb24gdG8gdmFsaWRhdGUuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5wb3NpdGlvbkNvbHVtbiAtIFBvc2l0aW9uIGF0dHJpYnV0ZSBuYW1lLlxuICogQHBhcmFtIHtib29sZWFufSBbYXJncy5wZXJzaXN0ZWRdIC0gV2hldGhlciB0aGUgaW52YWxpZCB2YWx1ZSBjYW1lIGZyb20gcGVyc2lzdGVkIHN0YXRlLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIGFzc2VydFBvc2l0aXZlUG9zaXRpb24oe3Bvc2l0aW9uLCBwb3NpdGlvbkNvbHVtbiwgcGVyc2lzdGVkID0gZmFsc2V9KSB7XG4gIGlmICh0eXBlb2YgcG9zaXRpb24gPT09IFwibnVtYmVyXCIgJiYgTnVtYmVyLmlzSW50ZWdlcihwb3NpdGlvbikgJiYgcG9zaXRpb24gPiAwKSByZXR1cm5cblxuICBjb25zdCBzb3VyY2UgPSBwZXJzaXN0ZWQgPyBcIlBlcnNpc3RlZFwiIDogXCJSZXF1ZXN0ZWRcIlxuXG4gIHRocm93IG5ldyBFcnJvcihgJHtzb3VyY2V9IGFjdHNBc0xpc3QgJHtwb3NpdGlvbkNvbHVtbn0gbXVzdCBiZSBhIHBvc2l0aXZlIGludGVnZXJgKVxufVxuXG4vKipcbiAqIFBsYWNlcyBhIG1vdmVkIHJvdyBhZnRlciBzdXJyb3VuZGluZyByb3dzIGhhdmUgc2hpZnRlZC5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MucmVjb3JkIC0gTW9kZWwgaW5zdGFuY2UuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5wb3NpdGlvbkNvbHVtbiAtIFBvc2l0aW9uIGF0dHJpYnV0ZSBuYW1lLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc2NvcGUgLSBTY29wZSBhdHRyaWJ1dGUgbmFtZS5cbiAqIEBwYXJhbSB7c3RyaW5nIHwgbnVtYmVyfSBhcmdzLnNjb3BlVmFsdWUgLSBEZXN0aW5hdGlvbiBzY29wZSB2YWx1ZS5cbiAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLnBvc2l0aW9uIC0gRGVzdGluYXRpb24gcG9zaXRpb24uXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gUmVzb2x2ZXMgYWZ0ZXIgcGxhY2VtZW50LlxuICovXG5hc3luYyBmdW5jdGlvbiBwbGFjZU1vdmVkUmVjb3JkKHtyZWNvcmQsIHBvc2l0aW9uQ29sdW1uLCBzY29wZSwgc2NvcGVWYWx1ZSwgcG9zaXRpb259KSB7XG4gIGNvbnN0IG1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9ICovIChyZWNvcmQuY29uc3RydWN0b3IpXG4gIGNvbnN0IGNvbm5lY3Rpb24gPSByZWNvcmQuY29ubmVjdGlvbigpXG4gIGNvbnN0IHRhYmxlU3FsID0gY29ubmVjdGlvbi5xdW90ZVRhYmxlKG1vZGVsQ2xhc3MuX2dldFRhYmxlKCkuZ2V0TmFtZSgpKVxuICBjb25zdCBzY29wZUNvbCA9IG1vZGVsQ2xhc3MuZ2V0Q29sdW1uTmFtZUZvckF0dHJpYnV0ZU5hbWUoc2NvcGUpXG4gIGNvbnN0IHBvc0NvbCA9IG1vZGVsQ2xhc3MuZ2V0Q29sdW1uTmFtZUZvckF0dHJpYnV0ZU5hbWUocG9zaXRpb25Db2x1bW4pXG4gIGNvbnN0IHByZXNlcnZlZENoYW5nZXMgPSB7Li4ucmVjb3JkLl9jaGFuZ2VzfVxuICBjb25zdCBzY29wZUNvbHVtblNxbCA9IGNvbm5lY3Rpb24ucXVvdGVDb2x1bW4oc2NvcGVDb2wpXG4gIGNvbnN0IHBvc2l0aW9uQ29sdW1uU3FsID0gY29ubmVjdGlvbi5xdW90ZUNvbHVtbihwb3NDb2wpXG4gIGNvbnN0IHByaW1hcnlLZXkgPSBhY3RzQXNMaXN0UHJpbWFyeUtleShtb2RlbENsYXNzKVxuICBjb25zdCBwcmltYXJ5S2V5U3FsID0gY29ubmVjdGlvbi5xdW90ZUNvbHVtbihwcmltYXJ5S2V5KVxuICBjb25zdCByZWNvcmRJZCA9IGFjdHNBc0xpc3RSZWNvcmRJZChyZWNvcmQpXG5cbiAgZGVsZXRlIHByZXNlcnZlZENoYW5nZXNbc2NvcGVDb2xdXG4gIGRlbGV0ZSBwcmVzZXJ2ZWRDaGFuZ2VzW3Bvc0NvbF1cblxuICBhd2FpdCBjb25uZWN0aW9uLnF1ZXJ5KFxuICAgIGBVUERBVEUgJHt0YWJsZVNxbH0gU0VUICR7c2NvcGVDb2x1bW5TcWx9ID0gJHtjb25uZWN0aW9uLnF1b3RlKHNjb3BlVmFsdWUpfSwgJHtwb3NpdGlvbkNvbHVtblNxbH0gPSAke2Nvbm5lY3Rpb24ucXVvdGUocG9zaXRpb24pfSBXSEVSRSAke3ByaW1hcnlLZXlTcWx9ID0gJHtjb25uZWN0aW9uLnF1b3RlKHJlY29yZElkKX1gXG4gIClcbiAgYXdhaXQgcmVjb3JkLl9yZWxvYWRXaXRoSWQocmVjb3JkSWQpXG4gIHJlY29yZC5fY2hhbmdlcyA9IHByZXNlcnZlZENoYW5nZXNcbiAgY2xlYXJCZWxvbmdzVG9DaGFuZ2VGb3JTY29wZShyZWNvcmQpXG59XG5cbi8qKlxuICogQ2xlYXJzIGRpcnR5IGJlbG9uZ3MtdG8gc3RhdGUgZm9yIHRoZSBzY29wZSBGSyBhZnRlciBkaXJlY3QgcGxhY2VtZW50LlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IHJlY29yZCAtIE1vZGVsIGluc3RhbmNlLlxuICogQHJldHVybnMge3ZvaWR9IE5vdGhpbmcuXG4gKi9cbmZ1bmN0aW9uIGNsZWFyQmVsb25nc1RvQ2hhbmdlRm9yU2NvcGUocmVjb3JkKSB7XG4gIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBpbiByZWNvcmQuX2luc3RhbmNlUmVsYXRpb25zaGlwcyB8fCB7fSkge1xuICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IHJlY29yZC5faW5zdGFuY2VSZWxhdGlvbnNoaXBzW3JlbGF0aW9uc2hpcE5hbWVdXG5cbiAgICBpZiAocmVsYXRpb25zaGlwLmdldFR5cGUoKSAhPT0gXCJiZWxvbmdzVG9cIikgY29udGludWVcblxuICAgIHJlbGF0aW9uc2hpcC5zZXREaXJ0eShmYWxzZSlcbiAgfVxufVxuXG4vKipcbiAqIEJ1bXBzIHBvc2l0aW9ucyBVUCBieSAxIGluIHRoZSByYW5nZSBbZnJvbVBvc2l0aW9uLCB0b1Bvc2l0aW9uKSB3aXRoaW4gdGhlXG4gKiBzYW1lIHNjb3BlLiBVcGRhdGVzIGluIGRlc2NlbmRpbmcgb3JkZXIgdG8gYXZvaWQgaW50ZXJtZWRpYXRlIFVOSVFVRVxuICogY29uc3RyYWludCB2aW9sYXRpb25zLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5yZWNvcmQgLSBUaGUgbW9kZWwgaW5zdGFuY2Ugd2hvc2Ugc2NvcGUgaXMgdGhlIHNvdXJjZSBvZiB0cnV0aC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnBvc2l0aW9uQ29sdW1uIC0gY2FtZWxDYXNlIHBvc2l0aW9uIGF0dHJpYnV0ZSBuYW1lLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc2NvcGUgLSBjYW1lbENhc2Ugc2NvcGUgYXR0cmlidXRlIG5hbWUuXG4gKiBAcGFyYW0ge251bWJlcn0gYXJncy5mcm9tUG9zaXRpb24gLSBTdGFydGluZyBwb3NpdGlvbiAoaW5jbHVzaXZlKS5cbiAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy50b1Bvc2l0aW9uXSAtIEVuZGluZyBwb3NpdGlvbiAoZXhjbHVzaXZlKS5cbiAqIEBwYXJhbSB7c3RyaW5nIHwgbnVtYmVyfSBbYXJncy5zY29wZVZhbHVlXSAtIEV4cGxpY2l0IHNjb3BlIHZhbHVlLlxuICogQHBhcmFtIHtzdHJpbmcgfCBudW1iZXJ9IFthcmdzLmV4Y2x1ZGVSZWNvcmRJZF0gLSBSZWNvcmQgaWQgdG8gZXhjbHVkZSBmcm9tIHNoaWZ0cy5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICovXG5hc3luYyBmdW5jdGlvbiBzaGlmdFBvc2l0aW9uc1VwKHtyZWNvcmQsIHBvc2l0aW9uQ29sdW1uLCBzY29wZSwgZnJvbVBvc2l0aW9uLCB0b1Bvc2l0aW9uLCBzY29wZVZhbHVlLCBleGNsdWRlUmVjb3JkSWR9KSB7XG4gIGNvbnN0IG1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9ICovIChyZWNvcmQuY29uc3RydWN0b3IpXG4gIGNvbnN0IGNvbm5lY3Rpb24gPSByZWNvcmQuY29ubmVjdGlvbigpXG4gIGNvbnN0IHRhYmxlTmFtZSA9IG1vZGVsQ2xhc3MuX2dldFRhYmxlKCkuZ2V0TmFtZSgpXG4gIGNvbnN0IHJlc29sdmVkU2NvcGVWYWx1ZSA9IHNjb3BlVmFsdWUgIT0gbnVsbCA/IHNjb3BlVmFsdWUgOiByZXNvbHZlU2NvcGVWYWx1ZShyZWNvcmQsIHNjb3BlKVxuICBjb25zdCBzY29wZUNvbHVtbk5hbWUgPSBtb2RlbENsYXNzLmdldENvbHVtbk5hbWVGb3JBdHRyaWJ1dGVOYW1lKHNjb3BlKVxuXG4gIGlmIChyZXNvbHZlZFNjb3BlVmFsdWUgPT0gbnVsbCkgcmV0dXJuXG5cbiAgY29uc3QgcG9zaXRpb25Db2x1bW5OYW1lID0gbW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lRm9yQXR0cmlidXRlTmFtZShwb3NpdGlvbkNvbHVtbilcbiAgY29uc3QgcG9zaXRpb25Db2x1bW5TcWwgPSBjb25uZWN0aW9uLnF1b3RlQ29sdW1uKHBvc2l0aW9uQ29sdW1uTmFtZSlcbiAgY29uc3Qgc2NvcGVDb2x1bW5TcWwgPSBjb25uZWN0aW9uLnF1b3RlQ29sdW1uKHNjb3BlQ29sdW1uTmFtZSlcbiAgY29uc3QgcHJpbWFyeUtleSA9IGFjdHNBc0xpc3RQcmltYXJ5S2V5KG1vZGVsQ2xhc3MpXG4gIGNvbnN0IHByaW1hcnlLZXlTcWwgPSBjb25uZWN0aW9uLnF1b3RlQ29sdW1uKHByaW1hcnlLZXkpXG4gIGNvbnN0IHRhYmxlU3FsID0gY29ubmVjdGlvbi5xdW90ZVRhYmxlKHRhYmxlTmFtZSlcbiAgY29uc3QgcXVvdGVkU2NvcGUgPSBjb25uZWN0aW9uLnF1b3RlKHJlc29sdmVkU2NvcGVWYWx1ZSlcblxuICAvLyBMb2FkIHJvd3MgaW4gZGVzY2VuZGluZyBvcmRlciBzbyB3ZSBidW1wIHRoZSBoaWdoZXN0IGZpcnN0XG4gIGxldCBxdWVyeSA9IHJlY29yZFxuICAgIC5xdWVyeUZvck1vZGVsKG1vZGVsQ2xhc3MpXG4gICAgLnNlbGVjdChwcmltYXJ5S2V5KVxuICAgIC5zZWxlY3QocG9zaXRpb25Db2x1bW4pXG4gICAgLndoZXJlKHtbc2NvcGVDb2x1bW5OYW1lXTogcmVzb2x2ZWRTY29wZVZhbHVlfSlcbiAgICAud2hlcmUoYCR7cG9zaXRpb25Db2x1bW5TcWx9ID49ICR7Y29ubmVjdGlvbi5xdW90ZShmcm9tUG9zaXRpb24pfWApXG4gICAgLndoZXJlKGAke3Bvc2l0aW9uQ29sdW1uU3FsfSA+IDBgKVxuICAgIC5vcmRlcihgJHtwb3NpdGlvbkNvbHVtblNxbH0gREVTQ2ApXG5cbiAgY29uc3QgcmVjb3JkSWRUb0V4Y2x1ZGUgPSBleGNsdWRlUmVjb3JkSWQgfHwgKHJlY29yZC5pc1BlcnNpc3RlZCgpID8gYWN0c0FzTGlzdFJlY29yZElkKHJlY29yZCkgOiBudWxsKVxuXG4gIGlmIChyZWNvcmRJZFRvRXhjbHVkZSAhPSBudWxsKSB7XG4gICAgcXVlcnkgPSBxdWVyeS53aGVyZShgJHtwcmltYXJ5S2V5U3FsfSAhPSAke2Nvbm5lY3Rpb24ucXVvdGUocmVjb3JkSWRUb0V4Y2x1ZGUpfWApXG4gIH1cblxuICBpZiAodG9Qb3NpdGlvbiAhPSBudWxsKSB7XG4gICAgcXVlcnkgPSBxdWVyeS53aGVyZShgJHtwb3NpdGlvbkNvbHVtblNxbH0gPCAke2Nvbm5lY3Rpb24ucXVvdGUodG9Qb3NpdGlvbil9YClcbiAgfVxuXG4gIGNvbnN0IHJvd3MgPSBhd2FpdCBxdWVyeS50b0FycmF5KClcblxuICBzZXRTaGlmdGluZ0ZsYWcocmVjb3JkLCB0cnVlKVxuXG4gIHRyeSB7XG4gICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgICAgY29uc3QgY3VycmVudFBvcyA9IE51bWJlcihyb3cucmVhZEF0dHJpYnV0ZShwb3NpdGlvbkNvbHVtbikpXG5cbiAgICAgIGF3YWl0IGNvbm5lY3Rpb24ucXVlcnkoXG4gICAgICAgIGBVUERBVEUgJHt0YWJsZVNxbH0gU0VUICR7cG9zaXRpb25Db2x1bW5TcWx9ID0gJHtwb3NpdGlvbkNvbHVtblNxbH0gKyAxIFdIRVJFICR7cHJpbWFyeUtleVNxbH0gPSAke2Nvbm5lY3Rpb24ucXVvdGUocm93LmlkKCkpfSBBTkQgJHtzY29wZUNvbHVtblNxbH0gPSAke3F1b3RlZFNjb3BlfSBBTkQgJHtwb3NpdGlvbkNvbHVtblNxbH0gPSAke2Nvbm5lY3Rpb24ucXVvdGUoY3VycmVudFBvcyl9YFxuICAgICAgKVxuICAgIH1cbiAgfSBmaW5hbGx5IHtcbiAgICBzZXRTaGlmdGluZ0ZsYWcocmVjb3JkLCBmYWxzZSlcbiAgfVxufVxuXG4vKipcbiAqIEJ1bXBzIHBvc2l0aW9ucyBET1dOIGJ5IDEgaW4gdGhlIHJhbmdlIFtmcm9tUG9zaXRpb24sIHRvUG9zaXRpb24pIHdpdGhpblxuICogdGhlIHNhbWUgc2NvcGUuIFVwZGF0ZXMgaW4gYXNjZW5kaW5nIG9yZGVyIHRvIGF2b2lkIGludGVybWVkaWF0ZSBVTklRVUVcbiAqIGNvbnN0cmFpbnQgdmlvbGF0aW9ucy5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MucmVjb3JkIC0gVGhlIG1vZGVsIGluc3RhbmNlIHdob3NlIHNjb3BlIGlzIHRoZSBzb3VyY2Ugb2YgdHJ1dGguXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5wb3NpdGlvbkNvbHVtbiAtIGNhbWVsQ2FzZSBwb3NpdGlvbiBhdHRyaWJ1dGUgbmFtZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjb3BlIC0gY2FtZWxDYXNlIHNjb3BlIGF0dHJpYnV0ZSBuYW1lLlxuICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuZnJvbVBvc2l0aW9uIC0gU3RhcnRpbmcgcG9zaXRpb24gKGluY2x1c2l2ZSkuXG4gKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MudG9Qb3NpdGlvbl0gLSBFbmRpbmcgcG9zaXRpb24gKGV4Y2x1c2l2ZSkuXG4gKiBAcGFyYW0ge3N0cmluZyB8IG51bWJlcn0gW2FyZ3Muc2NvcGVWYWx1ZV0gLSBFeHBsaWNpdCBzY29wZSB2YWx1ZS5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICovXG5hc3luYyBmdW5jdGlvbiBzaGlmdFBvc2l0aW9uc0Rvd24oe3JlY29yZCwgcG9zaXRpb25Db2x1bW4sIHNjb3BlLCBmcm9tUG9zaXRpb24sIHRvUG9zaXRpb24sIHNjb3BlVmFsdWV9KSB7XG4gIGNvbnN0IG1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9ICovIChyZWNvcmQuY29uc3RydWN0b3IpXG4gIGNvbnN0IGNvbm5lY3Rpb24gPSByZWNvcmQuY29ubmVjdGlvbigpXG4gIGNvbnN0IHRhYmxlTmFtZSA9IG1vZGVsQ2xhc3MuX2dldFRhYmxlKCkuZ2V0TmFtZSgpXG4gIGNvbnN0IHJlc29sdmVkU2NvcGVWYWx1ZSA9IHNjb3BlVmFsdWUgIT0gbnVsbCA/IHNjb3BlVmFsdWUgOiByZXNvbHZlU2NvcGVWYWx1ZShyZWNvcmQsIHNjb3BlKVxuICBjb25zdCBzY29wZUNvbHVtbk5hbWUgPSBtb2RlbENsYXNzLmdldENvbHVtbk5hbWVGb3JBdHRyaWJ1dGVOYW1lKHNjb3BlKVxuXG4gIGlmIChyZXNvbHZlZFNjb3BlVmFsdWUgPT0gbnVsbCkgcmV0dXJuXG5cbiAgY29uc3QgcG9zaXRpb25Db2x1bW5OYW1lID0gbW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lRm9yQXR0cmlidXRlTmFtZShwb3NpdGlvbkNvbHVtbilcbiAgY29uc3QgcG9zaXRpb25Db2x1bW5TcWwgPSBjb25uZWN0aW9uLnF1b3RlQ29sdW1uKHBvc2l0aW9uQ29sdW1uTmFtZSlcbiAgY29uc3Qgc2NvcGVDb2x1bW5TcWwgPSBjb25uZWN0aW9uLnF1b3RlQ29sdW1uKHNjb3BlQ29sdW1uTmFtZSlcbiAgY29uc3QgcHJpbWFyeUtleSA9IGFjdHNBc0xpc3RQcmltYXJ5S2V5KG1vZGVsQ2xhc3MpXG4gIGNvbnN0IHByaW1hcnlLZXlTcWwgPSBjb25uZWN0aW9uLnF1b3RlQ29sdW1uKHByaW1hcnlLZXkpXG4gIGNvbnN0IHRhYmxlU3FsID0gY29ubmVjdGlvbi5xdW90ZVRhYmxlKHRhYmxlTmFtZSlcbiAgY29uc3QgcXVvdGVkU2NvcGUgPSBjb25uZWN0aW9uLnF1b3RlKHJlc29sdmVkU2NvcGVWYWx1ZSlcblxuICAvLyBMb2FkIHJvd3MgaW4gYXNjZW5kaW5nIG9yZGVyIHNvIHdlIHNoaWZ0IHRoZSBsb3dlc3QgZ2FwIGZpcnN0XG4gIGxldCBxdWVyeSA9IHJlY29yZFxuICAgIC5xdWVyeUZvck1vZGVsKG1vZGVsQ2xhc3MpXG4gICAgLnNlbGVjdChwcmltYXJ5S2V5KVxuICAgIC5zZWxlY3QocG9zaXRpb25Db2x1bW4pXG4gICAgLndoZXJlKHtbc2NvcGVDb2x1bW5OYW1lXTogcmVzb2x2ZWRTY29wZVZhbHVlfSlcbiAgICAud2hlcmUoYCR7cG9zaXRpb25Db2x1bW5TcWx9ID49ICR7Y29ubmVjdGlvbi5xdW90ZShmcm9tUG9zaXRpb24pfWApXG4gICAgLndoZXJlKGAke3Bvc2l0aW9uQ29sdW1uU3FsfSA+IDBgKVxuICAgIC53aGVyZShgJHtwcmltYXJ5S2V5U3FsfSAhPSAke2Nvbm5lY3Rpb24ucXVvdGUoYWN0c0FzTGlzdFJlY29yZElkKHJlY29yZCkpfWApXG4gICAgLm9yZGVyKHtjb2x1bW46IHBvc2l0aW9uQ29sdW1uTmFtZSwgZGlyZWN0aW9uOiBcIkFTQ1wifSlcblxuICBpZiAodG9Qb3NpdGlvbiAhPSBudWxsKSB7XG4gICAgcXVlcnkgPSBxdWVyeS53aGVyZShgJHtwb3NpdGlvbkNvbHVtblNxbH0gPCAke2Nvbm5lY3Rpb24ucXVvdGUodG9Qb3NpdGlvbil9YClcbiAgfVxuXG4gIGNvbnN0IHJvd3MgPSBhd2FpdCBxdWVyeS50b0FycmF5KClcblxuICBzZXRTaGlmdGluZ0ZsYWcocmVjb3JkLCB0cnVlKVxuXG4gIHRyeSB7XG4gICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgICAgY29uc3QgY3VycmVudFBvcyA9IE51bWJlcihyb3cucmVhZEF0dHJpYnV0ZShwb3NpdGlvbkNvbHVtbikpXG5cbiAgICAgIGF3YWl0IGNvbm5lY3Rpb24ucXVlcnkoXG4gICAgICAgIGBVUERBVEUgJHt0YWJsZVNxbH0gU0VUICR7cG9zaXRpb25Db2x1bW5TcWx9ID0gJHtwb3NpdGlvbkNvbHVtblNxbH0gLSAxIFdIRVJFICR7cHJpbWFyeUtleVNxbH0gPSAke2Nvbm5lY3Rpb24ucXVvdGUocm93LmlkKCkpfSBBTkQgJHtzY29wZUNvbHVtblNxbH0gPSAke3F1b3RlZFNjb3BlfSBBTkQgJHtwb3NpdGlvbkNvbHVtblNxbH0gPSAke2Nvbm5lY3Rpb24ucXVvdGUoY3VycmVudFBvcyl9YFxuICAgICAgKVxuICAgIH1cbiAgfSBmaW5hbGx5IHtcbiAgICBzZXRTaGlmdGluZ0ZsYWcocmVjb3JkLCBmYWxzZSlcbiAgfVxufVxuXG4vKipcbiAqIFJldHVybnMgdGhlIGhpZ2hlc3QgY3VycmVudCBwb3NpdGlvbiB2YWx1ZSBpbiB0aGUgcmVjb3JkJ3Mgc2NvcGUuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnJlY29yZCAtIFRoZSBtb2RlbCBpbnN0YW5jZSB3aG9zZSBzY29wZSBpcyB0aGUgc291cmNlIG9mIHRydXRoLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucG9zaXRpb25Db2x1bW4gLSBjYW1lbENhc2UgcG9zaXRpb24gYXR0cmlidXRlIG5hbWUuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zY29wZSAtIGNhbWVsQ2FzZSBzY29wZSBhdHRyaWJ1dGUgbmFtZS5cbiAqIEBwYXJhbSB7c3RyaW5nIHwgbnVtYmVyfSBbYXJncy5zY29wZVZhbHVlXSAtIEV4cGxpY2l0IHNjb3BlIHZhbHVlLlxuICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gLSBIaWdoZXN0IHBvc2l0aW9uIGluIHNjb3BlLCBvciAwIHdoZW4gc2NvcGUgaXMgZW1wdHkuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGhpZ2hlc3RQb3NpdGlvbkluU2NvcGUoe3JlY29yZCwgcG9zaXRpb25Db2x1bW4sIHNjb3BlLCBzY29wZVZhbHVlfSkge1xuICBjb25zdCBtb2RlbENsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSAqLyAocmVjb3JkLmNvbnN0cnVjdG9yKVxuICBjb25zdCBjb25uZWN0aW9uID0gcmVjb3JkLmNvbm5lY3Rpb24oKVxuICBjb25zdCBzY29wZUNvbHVtbk5hbWUgPSBtb2RlbENsYXNzLmdldENvbHVtbk5hbWVGb3JBdHRyaWJ1dGVOYW1lKHNjb3BlKVxuICBjb25zdCBwb3NpdGlvbkNvbHVtbk5hbWUgPSBtb2RlbENsYXNzLmdldENvbHVtbk5hbWVGb3JBdHRyaWJ1dGVOYW1lKHBvc2l0aW9uQ29sdW1uKVxuICBjb25zdCBwb3NpdGlvbkNvbHVtblNxbCA9IGNvbm5lY3Rpb24ucXVvdGVDb2x1bW4ocG9zaXRpb25Db2x1bW5OYW1lKVxuICBjb25zdCByZXNvbHZlZFNjb3BlVmFsdWUgPSBzY29wZVZhbHVlICE9IG51bGwgPyBzY29wZVZhbHVlIDogcmVzb2x2ZVNjb3BlVmFsdWUocmVjb3JkLCBzY29wZSlcblxuICBpZiAocmVzb2x2ZWRTY29wZVZhbHVlID09IG51bGwpIHJldHVybiAwXG5cbiAgY29uc3Qgcm93cyA9IGF3YWl0IHJlY29yZFxuICAgIC5xdWVyeUZvck1vZGVsKG1vZGVsQ2xhc3MpXG4gICAgLnNlbGVjdChwb3NpdGlvbkNvbHVtbilcbiAgICAud2hlcmUoe1tzY29wZUNvbHVtbk5hbWVdOiByZXNvbHZlZFNjb3BlVmFsdWV9KVxuICAgIC5vcmRlcihgJHtwb3NpdGlvbkNvbHVtblNxbH0gREVTQ2ApXG4gICAgLmxpbWl0KDEpXG4gICAgLnRvQXJyYXkoKVxuXG4gIGlmIChyb3dzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIDBcblxuICByZXR1cm4gTnVtYmVyKHJvd3NbMF0ucmVhZEF0dHJpYnV0ZShwb3NpdGlvbkNvbHVtbikpIHx8IDBcbn1cblxuLyoqXG4gKiBSZXNvbHZlcyBhIHNjb3BlIHZhbHVlIGZyb20gdGhlIGF0dHJpYnV0ZSBzdG9yZSBmaXJzdCwgdGhlbiBmYWxscyBiYWNrXG4gKiB0byB0aGUgbG9hZGVkIGJlbG9uZ3NUbyByZWxhdGlvbnNoaXAuIFRoaXMgaXMgbmVlZGVkIGR1cmluZyBiZWZvcmVDcmVhdGVcbiAqIGJlY2F1c2UgdGhlIEZLIGF0dHJpYnV0ZSBtYXkgbm90IGJlIHNldCB1bnRpbCBfY3JlYXRlTmV3UmVjb3JkIGZsdXNoZXNcbiAqIF9iZWxvbmdzVG9DaGFuZ2VzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IHJlY29yZCAtIE1vZGVsIGluc3RhbmNlLlxuICogQHBhcmFtIHtzdHJpbmd9IHNjb3BlIC0gY2FtZWxDYXNlIHNjb3BlIGF0dHJpYnV0ZSBuYW1lIChlLmcuIFwicHJvamVjdElkXCIpLlxuICogQHJldHVybnMge3N0cmluZyB8IG51bWJlciB8IG51bGx9IC0gQ3VycmVudCBsaXN0IHBvc2l0aW9uIHZhbHVlLlxuICovXG5mdW5jdGlvbiByZXNvbHZlU2NvcGVWYWx1ZShyZWNvcmQsIHNjb3BlKSB7XG4gIGNvbnN0IGF0dHJWYWx1ZSA9IHJlY29yZC5yZWFkQXR0cmlidXRlKHNjb3BlKVxuXG4gIGlmIChhdHRyVmFsdWUgIT0gbnVsbCkgcmV0dXJuIC8qKiBAdHlwZSB7c3RyaW5nIHwgbnVtYmVyfSAqLyAoYXR0clZhbHVlKVxuXG4gIGNvbnN0IG1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9ICovIChyZWNvcmQuY29uc3RydWN0b3IpXG4gIGNvbnN0IHJlbGF0aW9uc2hpcHMgPSBtb2RlbENsYXNzLmdldFJlbGF0aW9uc2hpcHNNYXAoKVxuICBjb25zdCBzY29wZUNvbHVtbk5hbWUgPSBtb2RlbENsYXNzLmdldENvbHVtbk5hbWVGb3JBdHRyaWJ1dGVOYW1lKHNjb3BlKVxuXG4gIGZvciAoY29uc3QgcmVsYXRpb25zaGlwTmFtZSBpbiByZWxhdGlvbnNoaXBzKSB7XG4gICAgY29uc3QgcmVsYXRpb25zaGlwID0gcmVsYXRpb25zaGlwc1tyZWxhdGlvbnNoaXBOYW1lXVxuXG4gICAgaWYgKHJlbGF0aW9uc2hpcC5nZXRUeXBlPy4oKSAhPT0gXCJiZWxvbmdzVG9cIikgY29udGludWVcblxuICAgIGNvbnN0IGZvcmVpZ25LZXkgPSByZWxhdGlvbnNoaXAuZ2V0Rm9yZWlnbktleSgpXG5cbiAgICBpZiAoZm9yZWlnbktleSAhPT0gc2NvcGVDb2x1bW5OYW1lKSBjb250aW51ZVxuXG4gICAgY29uc3QgaW5zdGFuY2VSZWxhdGlvbnNoaXAgPSByZWNvcmQuZ2V0UmVsYXRpb25zaGlwQnlOYW1lKHJlbGF0aW9uc2hpcE5hbWUpXG4gICAgY29uc3QgbG9hZGVkID0gaW5zdGFuY2VSZWxhdGlvbnNoaXAubG9hZGVkKClcblxuICAgIGlmIChsb2FkZWQgJiYgIUFycmF5LmlzQXJyYXkobG9hZGVkKSAmJiB0eXBlb2YgbG9hZGVkLmlkID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHJldHVybiBzY2FsYXJNb2RlbFByaW1hcnlLZXlWYWx1ZShsb2FkZWQuaWQoKSwgYGFjdHNBc0xpc3Qgc2NvcGUgcmVsYXRpb25zaGlwIGZvciAke21vZGVsQ2xhc3MubmFtZX1gKVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBudWxsXG59XG5cbi8qKlxuICogTW92ZXMgdGhlIHJlY29yZCB0byBhIHRlbXBvcmFyeSBwb3NpdGlvbiBvdXRzaWRlIHRoZSBub3JtYWwgcmFuZ2Ugc29cbiAqIHRoYXQgc3Vycm91bmRpbmcgcG9zaXRpb24gc2hpZnRzIGRvIG5vdCBoaXQgdW5pcXVlIGNvbnN0cmFpbnQgdmlvbGF0aW9ucy5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MucmVjb3JkIC0gTW9kZWwgaW5zdGFuY2UuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5wb3NpdGlvbkNvbHVtbiAtIGNhbWVsQ2FzZSBwb3NpdGlvbiBhdHRyaWJ1dGUuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zY29wZSAtIGNhbWVsQ2FzZSBzY29wZSBhdHRyaWJ1dGUuXG4gKiBAcGFyYW0ge3N0cmluZyB8IG51bWJlciB8IG51bGx9IFthcmdzLnNjb3BlVmFsdWVdIC0gU2NvcGUgY29udGFpbmluZyB0aGUgcmVjb3JkIGJlZm9yZSBtb3ZlLW91dC5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICovXG5hc3luYyBmdW5jdGlvbiBtb3ZlT3V0T2ZXYXkoe3JlY29yZCwgcG9zaXRpb25Db2x1bW4sIHNjb3BlLCBzY29wZVZhbHVlfSkge1xuICBjb25zdCBtb2RlbENsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSAqLyAocmVjb3JkLmNvbnN0cnVjdG9yKVxuICBjb25zdCBjb25uZWN0aW9uID0gcmVjb3JkLmNvbm5lY3Rpb24oKVxuICBjb25zdCB0YWJsZU5hbWUgPSBtb2RlbENsYXNzLl9nZXRUYWJsZSgpLmdldE5hbWUoKVxuICBjb25zdCByZXNvbHZlZFNjb3BlVmFsdWUgPSBzY29wZVZhbHVlICE9IG51bGwgPyBzY29wZVZhbHVlIDogcmVzb2x2ZVNjb3BlVmFsdWUocmVjb3JkLCBzY29wZSlcblxuICBpZiAocmVzb2x2ZWRTY29wZVZhbHVlID09IG51bGwpIHJldHVyblxuXG4gIGNvbnN0IHBvc2l0aW9uQ29sdW1uU3FsID0gY29ubmVjdGlvbi5xdW90ZUNvbHVtbihtb2RlbENsYXNzLmdldENvbHVtbk5hbWVGb3JBdHRyaWJ1dGVOYW1lKHBvc2l0aW9uQ29sdW1uKSlcbiAgY29uc3Qgc2NvcGVDb2x1bW5TcWwgPSBjb25uZWN0aW9uLnF1b3RlQ29sdW1uKG1vZGVsQ2xhc3MuZ2V0Q29sdW1uTmFtZUZvckF0dHJpYnV0ZU5hbWUoc2NvcGUpKVxuICBjb25zdCB0YWJsZVNxbCA9IGNvbm5lY3Rpb24ucXVvdGVUYWJsZSh0YWJsZU5hbWUpXG4gIGNvbnN0IHBrU3FsID0gY29ubmVjdGlvbi5xdW90ZUNvbHVtbihhY3RzQXNMaXN0UHJpbWFyeUtleShtb2RlbENsYXNzKSlcblxuICBzZXRTaGlmdGluZ0ZsYWcocmVjb3JkLCB0cnVlKVxuXG4gIHRyeSB7XG4gICAgYXdhaXQgY29ubmVjdGlvbi5xdWVyeShcbiAgICAgIGBVUERBVEUgJHt0YWJsZVNxbH0gU0VUICR7cG9zaXRpb25Db2x1bW5TcWx9ID0gLSR7cG9zaXRpb25Db2x1bW5TcWx9IFdIRVJFICR7c2NvcGVDb2x1bW5TcWx9ID0gJHtjb25uZWN0aW9uLnF1b3RlKHJlc29sdmVkU2NvcGVWYWx1ZSl9IEFORCAke3BrU3FsfSA9ICR7Y29ubmVjdGlvbi5xdW90ZShhY3RzQXNMaXN0UmVjb3JkSWQocmVjb3JkKSl9YFxuICAgIClcbiAgfSBmaW5hbGx5IHtcbiAgICAvLyBEb24ndCBjbGVhciB0aGUgZmxhZyBoZXJlIOKAlCB0aGUgY2FsbGVyIHdpbGwgZG8gdGhhdCBhZnRlciBzaGlmdHNcbiAgfVxufVxuIl19