// @ts-check
/** @file Registers gap-less positional list callbacks on a model class. */
/**
 * Acts as list shifting.
 * @type {symbol} - Guard flag set on the model instance during shift operations to prevent re-entrant lifecycle hooks.
 */
const ACTS_AS_LIST_SHIFTING = Symbol("actsAsListShifting");
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
            await shiftPositionsUp({ record, positionColumn, scope, scopeValue: newScopeValue, fromPosition: newPosition, excludeRecordId: record.id() });
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
    const primaryKeySql = connection.quoteColumn(modelClass.primaryKey());
    delete preservedChanges[scopeCol];
    delete preservedChanges[posCol];
    await connection.query(`UPDATE ${tableSql} SET ${scopeColumnSql} = ${connection.quote(scopeValue)}, ${positionColumnSql} = ${connection.quote(position)} WHERE ${primaryKeySql} = ${connection.quote(record.id())}`);
    await record._reloadWithId(record.id());
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
    const primaryKeySql = connection.quoteColumn(modelClass.primaryKey());
    const tableSql = connection.quoteTable(tableName);
    const quotedScope = connection.quote(resolvedScopeValue);
    // Load rows in descending order so we bump the highest first
    let query = record
        .queryForModel(modelClass)
        .select(modelClass.primaryKey())
        .select(positionColumn)
        .where({ [scopeColumnName]: resolvedScopeValue })
        .where(`${positionColumnSql} >= ${connection.quote(fromPosition)}`)
        .where(`${positionColumnSql} > 0`)
        .order(`${positionColumnSql} DESC`);
    const recordIdToExclude = excludeRecordId || (record.isPersisted() ? record.id() : null);
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
    const primaryKeySql = connection.quoteColumn(modelClass.primaryKey());
    const tableSql = connection.quoteTable(tableName);
    const quotedScope = connection.quote(resolvedScopeValue);
    // Load rows in ascending order so we shift the lowest gap first
    let query = record
        .queryForModel(modelClass)
        .select(modelClass.primaryKey())
        .select(positionColumn)
        .where({ [scopeColumnName]: resolvedScopeValue })
        .where(`${positionColumnSql} >= ${connection.quote(fromPosition)}`)
        .where(`${positionColumnSql} > 0`)
        .where(`${primaryKeySql} != ${connection.quote(record.id())}`)
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
            return loaded.id();
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
    const pkSql = connection.quoteColumn(modelClass.primaryKey());
    setShiftingFlag(record, true);
    try {
        await connection.query(`UPDATE ${tableSql} SET ${positionColumnSql} = -${positionColumnSql} WHERE ${scopeColumnSql} = ${connection.quote(resolvedScopeValue)} AND ${pkSql} = ${connection.quote(record.id())}`);
    }
    finally {
        // Don't clear the flag here — the caller will do that after shifts
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWN0cy1hcy1saXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2RhdGFiYXNlL3JlY29yZC9hY3RzLWFzLWxpc3QuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLDJFQUEyRTtBQUUzRTs7O0dBR0c7QUFDSCxNQUFNLHFCQUFxQixHQUFHLE1BQU0sQ0FBQyxvQkFBb0IsQ0FBQyxDQUFBO0FBRTFEOzs7O0dBSUc7QUFDSCxTQUFTLGVBQWUsQ0FBQyxNQUFNLEVBQUUsS0FBSztJQUNwQyxtREFBbUQ7SUFDbkQsTUFBTSxDQUFDLHFCQUFxQixDQUFDLEdBQUcsS0FBSyxDQUFBO0FBQ3ZDLENBQUM7QUFFRDs7OztHQUlHO0FBQ0gsU0FBUyxVQUFVLENBQUMsTUFBTTtJQUN4QixtREFBbUQ7SUFDbkQsT0FBTyxPQUFPLENBQUMsTUFBTSxDQUFDLHFCQUFxQixDQUFDLENBQUMsQ0FBQTtBQUMvQyxDQUFDO0FBRUQ7Ozs7Ozs7Ozs7Ozs7O0dBY0c7QUFDSCxNQUFNLENBQUMsT0FBTyxVQUFVLDJCQUEyQixDQUFDLFVBQVUsRUFBRSxjQUFjLEVBQUUsRUFBQyxLQUFLLEVBQUM7SUFDckYsVUFBVSxDQUFDLFlBQVksQ0FBQyxLQUFLLEVBQUUsTUFBTSxFQUFFLEVBQUU7UUFDdkMsSUFBSSxVQUFVLENBQUMsTUFBTSxDQUFDO1lBQUUsT0FBTTtRQUU5QixNQUFNLFFBQVEsR0FBRyxNQUFNLENBQUMsYUFBYSxDQUFDLGNBQWMsQ0FBQyxDQUFBO1FBRXJELElBQUksUUFBUSxJQUFJLElBQUksRUFBRSxDQUFDO1lBQ3JCLHNCQUFzQixDQUFDLEVBQUMsUUFBUSxFQUFFLGNBQWMsRUFBQyxDQUFDLENBQUE7WUFDbEQsTUFBTSxnQkFBZ0IsQ0FBQyxFQUFDLE1BQU0sRUFBRSxjQUFjLEVBQUUsS0FBSyxFQUFFLFlBQVksRUFBRSxRQUFRLEVBQUMsQ0FBQyxDQUFBO1FBQ2pGLENBQUM7YUFBTSxDQUFDO1lBQ04s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Q29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuLyoqIEBmaWxlIFJlZ2lzdGVycyBnYXAtbGVzcyBwb3NpdGlvbmFsIGxpc3QgY2FsbGJhY2tzIG9uIGEgbW9kZWwgY2xhc3MuICovXG5cbi8qKlxuICogQWN0cyBhcyBsaXN0IHNoaWZ0aW5nLlxuICogQHR5cGUge3N5bWJvbH0gLSBHdWFyZCBmbGFnIHNldCBvbiB0aGUgbW9kZWwgaW5zdGFuY2UgZHVyaW5nIHNoaWZ0IG9wZXJhdGlvbnMgdG8gcHJldmVudCByZS1lbnRyYW50IGxpZmVjeWNsZSBob29rcy5cbiAqL1xuY29uc3QgQUNUU19BU19MSVNUX1NISUZUSU5HID0gU3ltYm9sKFwiYWN0c0FzTGlzdFNoaWZ0aW5nXCIpXG5cbi8qKlxuICogUnVucyBzZXQgc2hpZnRpbmcgZmxhZy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSByZWNvcmQgLSBNb2RlbCBpbnN0YW5jZS5cbiAqIEBwYXJhbSB7Ym9vbGVhbn0gdmFsdWUgLSBGbGFnIHZhbHVlLlxuICovXG5mdW5jdGlvbiBzZXRTaGlmdGluZ0ZsYWcocmVjb3JkLCB2YWx1ZSkge1xuICAvLyBAdHMtaWdub3JlIC0gU3ltYm9sIGluZGV4aW5nIG9uIFJlY29yZCBpbnN0YW5jZXNcbiAgcmVjb3JkW0FDVFNfQVNfTElTVF9TSElGVElOR10gPSB2YWx1ZVxufVxuXG4vKipcbiAqIFJ1bnMgaXMgc2hpZnRpbmcuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gcmVjb3JkIC0gTW9kZWwgaW5zdGFuY2UuXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gLSBXaGV0aGVyIGxpc3QgcG9zaXRpb25zIGFyZSBjdXJyZW50bHkgc2hpZnRpbmcuXG4gKi9cbmZ1bmN0aW9uIGlzU2hpZnRpbmcocmVjb3JkKSB7XG4gIC8vIEB0cy1pZ25vcmUgLSBTeW1ib2wgaW5kZXhpbmcgb24gUmVjb3JkIGluc3RhbmNlc1xuICByZXR1cm4gQm9vbGVhbihyZWNvcmRbQUNUU19BU19MSVNUX1NISUZUSU5HXSlcbn1cblxuLyoqXG4gKiBSZWdpc3RlcnMgZ2FwLWxlc3MgcG9zaXRpb25hbCBsaXN0IGNhbGxiYWNrcyBvbiBhIG1vZGVsIGNsYXNzIHRvIG1haW50YWluXG4gKiBhIGdhcC1sZXNzIHBvc2l0aW9uYWwgbGlzdC4gV2hlbiBhIHJlY29yZCBpcyBpbnNlcnRlZCwgdXBkYXRlZCwgb3JcbiAqIGRlc3Ryb3llZCwgdGhlIHN1cnJvdW5kaW5nIHBvc2l0aW9ucyBhcmUgc2hpZnRlZCBzbyB0aGUgbGlzdCBzdGF5cyBjb21wYWN0XG4gKiAoMSwyLDMsLi4uKSBhbmQgc2NvcGVkIHdpdGhpbiB0aGUgZ2l2ZW4gY29sdW1uLlxuICpcbiAqIENhbGxlcnMgbXVzdCBhbHNvIGVuc3VyZSBhIFVOSVFVRSBpbmRleCBvbiAoc2NvcGVDb2x1bW4sIHBvc2l0aW9uQ29sdW1uKVxuICogZXhpc3RzIGluIHRoZSBkYXRhYmFzZSBzY2hlbWEg4oCUIHVzZSBgTWlncmF0aW9uLmFkZEFjdHNBc0xpc3QoKWAgZm9yIHRoZVxuICogY29ycmVzcG9uZGluZyBzY2hlbWEgc2V0dXAuXG4gKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBUaGUgbW9kZWwgY2xhc3MuXG4gKiBAcGFyYW0ge3N0cmluZ30gcG9zaXRpb25Db2x1bW4gLSBjYW1lbENhc2UgbmFtZSBvZiB0aGUgcG9zaXRpb24gYXR0cmlidXRlIChlLmcuIFwicm93TnVtYmVyXCIpLlxuICogQHBhcmFtIHtvYmplY3R9IG9wdGlvbnMgLSBPcHRpb25zLlxuICogQHBhcmFtIHtzdHJpbmd9IG9wdGlvbnMuc2NvcGUgLSBjYW1lbENhc2UgbmFtZSBvZiB0aGUgc2NvcGUgYXR0cmlidXRlIChlLmcuIFwiYm9hcmRDb2x1bW5JZFwiKS5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiByZWdpc3RlckFjdHNBc0xpc3RDYWxsYmFja3MobW9kZWxDbGFzcywgcG9zaXRpb25Db2x1bW4sIHtzY29wZX0pIHtcbiAgbW9kZWxDbGFzcy5iZWZvcmVDcmVhdGUoYXN5bmMgKHJlY29yZCkgPT4ge1xuICAgIGlmIChpc1NoaWZ0aW5nKHJlY29yZCkpIHJldHVyblxuXG4gICAgY29uc3QgcG9zaXRpb24gPSByZWNvcmQucmVhZEF0dHJpYnV0ZShwb3NpdGlvbkNvbHVtbilcblxuICAgIGlmIChwb3NpdGlvbiAhPSBudWxsKSB7XG4gICAgICBhc3NlcnRQb3NpdGl2ZVBvc2l0aW9uKHtwb3NpdGlvbiwgcG9zaXRpb25Db2x1bW59KVxuICAgICAgYXdhaXQgc2hpZnRQb3NpdGlvbnNVcCh7cmVjb3JkLCBwb3NpdGlvbkNvbHVtbiwgc2NvcGUsIGZyb21Qb3NpdGlvbjogcG9zaXRpb259KVxuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBuZXh0UG9zaXRpb24gPSBhd2FpdCBoaWdoZXN0UG9zaXRpb25JblNjb3BlKHtyZWNvcmQsIHBvc2l0aW9uQ29sdW1uLCBzY29wZX0pXG5cbiAgICAgIHJlY29yZC5zZXRBdHRyaWJ1dGUocG9zaXRpb25Db2x1bW4sIG5leHRQb3NpdGlvbiArIDEpXG4gICAgfVxuICB9KVxuXG4gIG1vZGVsQ2xhc3MuYmVmb3JlVXBkYXRlKGFzeW5jIChyZWNvcmQpID0+IHtcbiAgICBpZiAoaXNTaGlmdGluZyhyZWNvcmQpKSByZXR1cm5cbiAgICBpZiAoIXJlY29yZC5pc1BlcnNpc3RlZCgpKSByZXR1cm5cblxuICAgIGNvbnN0IG1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9ICovIChyZWNvcmQuY29uc3RydWN0b3IpXG4gICAgY29uc3QgcG9zQ29sdW1uID0gbW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lRm9yQXR0cmlidXRlTmFtZShwb3NpdGlvbkNvbHVtbilcbiAgICBjb25zdCBzY29wZUNvbCA9IG1vZGVsQ2xhc3MuZ2V0Q29sdW1uTmFtZUZvckF0dHJpYnV0ZU5hbWUoc2NvcGUpXG4gICAgLyoqIEB0eXBlIHtSZWNvcmQ8c3RyaW5nLCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59ICovXG4gICAgY29uc3QgcmF3QXR0cmlidXRlcyA9IHJlY29yZC5fYXR0cmlidXRlcyB8fCB7fVxuICAgIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICAgIGNvbnN0IGNoYW5nZXMgPSByZWNvcmQuX2NoYW5nZXMgfHwge31cbiAgICAvKiogQHR5cGUge1NldDxzdHJpbmc+fSAqL1xuICAgIGNvbnN0IGFzc2lnbmVkQXR0cmlidXRlTmFtZXMgPSByZWNvcmQuX2Fzc2lnbmVkQXR0cmlidXRlTmFtZXMgfHwgbmV3IFNldCgpXG4gICAgY29uc3QgcG9zQ2hhbmdlZCA9IHBvc0NvbHVtbiBpbiBjaGFuZ2VzXG4gICAgY29uc3Qgc2NvcGVDaGFuZ2VkID0gc2NvcGVDb2wgaW4gY2hhbmdlc1xuICAgIGNvbnN0IHBvc0Fzc2lnbmVkID0gYXNzaWduZWRBdHRyaWJ1dGVOYW1lcy5oYXMocG9zaXRpb25Db2x1bW4pXG5cbiAgICBpZiAoIXBvc0NoYW5nZWQgJiYgIXNjb3BlQ2hhbmdlZCkgcmV0dXJuXG5cbiAgICBhc3NlcnRQb3NpdGl2ZVBvc2l0aW9uKHtcbiAgICAgIHBvc2l0aW9uOiByYXdBdHRyaWJ1dGVzW3Bvc0NvbHVtbl0sXG4gICAgICBwb3NpdGlvbkNvbHVtbixcbiAgICAgIHBlcnNpc3RlZDogdHJ1ZVxuICAgIH0pXG5cbiAgICBjb25zdCBvbGRQb3NpdGlvbiA9IHBvc0NoYW5nZWQgPyAvKiogQHR5cGUge251bWJlcn0gKi8gKHJhd0F0dHJpYnV0ZXNbcG9zQ29sdW1uXSkgOiAvKiogQHR5cGUge251bWJlcn0gKi8gKHJlY29yZC5yZWFkQXR0cmlidXRlKHBvc2l0aW9uQ29sdW1uKSlcbiAgICBjb25zdCBuZXdQb3NpdGlvbiA9IHBvc0NoYW5nZWQgPyAvKiogQHR5cGUge251bWJlcn0gKi8gKGNoYW5nZXNbcG9zQ29sdW1uXSkgOiAvKiogQHR5cGUge251bWJlcn0gKi8gKHJlY29yZC5yZWFkQXR0cmlidXRlKHBvc2l0aW9uQ29sdW1uKSlcbiAgICBjb25zdCBvbGRTY29wZVZhbHVlID0gc2NvcGVDaGFuZ2VkID8gLyoqIEB0eXBlIHtudW1iZXJ9ICovIChyYXdBdHRyaWJ1dGVzW3Njb3BlQ29sXSkgOiAvKiogQHR5cGUge251bWJlcn0gKi8gKHJlY29yZC5yZWFkQXR0cmlidXRlKHNjb3BlKSlcbiAgICBjb25zdCBuZXdTY29wZVZhbHVlID0gc2NvcGVDaGFuZ2VkID8gLyoqIEB0eXBlIHtudW1iZXJ9ICovIChjaGFuZ2VzW3Njb3BlQ29sXSkgOiAvKiogQHR5cGUge251bWJlcn0gKi8gKHJlY29yZC5yZWFkQXR0cmlidXRlKHNjb3BlKSlcblxuICAgIGFzc2VydFBvc2l0aXZlUG9zaXRpb24oe3Bvc2l0aW9uOiBuZXdQb3NpdGlvbiwgcG9zaXRpb25Db2x1bW59KVxuICAgIGlmIChvbGRQb3NpdGlvbiA9PSBudWxsKSByZXR1cm5cbiAgICBpZiAobmV3UG9zaXRpb24gPT09IG9sZFBvc2l0aW9uICYmIG5ld1Njb3BlVmFsdWUgPT09IG9sZFNjb3BlVmFsdWUpIHJldHVyblxuXG4gICAgaWYgKHNjb3BlQ2hhbmdlZCAmJiBvbGRTY29wZVZhbHVlICE9PSBuZXdTY29wZVZhbHVlKSB7XG4gICAgICAvLyBXaGVuIG9ubHkgdGhlIHNjb3BlIGNoYW5nZXMgd2l0aG91dCBhIG5ldyBwb3NpdGlvbiwgYXBwZW5kIHRvIHRoZSBlbmRcbiAgICAgIC8vIG9mIHRoZSBuZXcgc2NvcGUuIFRoZXJlIGlzIG5vIHRhcmdldC1zY29wZSByb3cgdG8gc2hpZnQgb3V0IG9mIHRoZSB3YXkuXG4gICAgICBpZiAoIXBvc0Fzc2lnbmVkKSB7XG4gICAgICAgIGF3YWl0IG1vdmVPdXRPZldheSh7cmVjb3JkLCBwb3NpdGlvbkNvbHVtbiwgc2NvcGUsIHNjb3BlVmFsdWU6IG9sZFNjb3BlVmFsdWV9KVxuICAgICAgICBzZXRTaGlmdGluZ0ZsYWcocmVjb3JkLCBmYWxzZSlcblxuICAgICAgICBjb25zdCBoaWdoZXN0TmV3ID0gYXdhaXQgaGlnaGVzdFBvc2l0aW9uSW5TY29wZSh7cmVjb3JkLCBwb3NpdGlvbkNvbHVtbiwgc2NvcGUsIHNjb3BlVmFsdWU6IG5ld1Njb3BlVmFsdWV9KVxuICAgICAgICBjb25zdCBuZXh0UG9zID0gaGlnaGVzdE5ldyArIDFcblxuICAgICAgICByZWNvcmQuc2V0QXR0cmlidXRlKHBvc2l0aW9uQ29sdW1uLCBuZXh0UG9zKVxuICAgICAgICBhd2FpdCBzaGlmdFBvc2l0aW9uc0Rvd24oe3JlY29yZCwgcG9zaXRpb25Db2x1bW4sIHNjb3BlLCBzY29wZVZhbHVlOiBvbGRTY29wZVZhbHVlLCBmcm9tUG9zaXRpb246IG9sZFBvc2l0aW9uICsgMX0pXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuXG4gICAgICBhd2FpdCBtb3ZlT3V0T2ZXYXkoe3JlY29yZCwgcG9zaXRpb25Db2x1bW4sIHNjb3BlLCBzY29wZVZhbHVlOiBvbGRTY29wZVZhbHVlfSlcbiAgICAgIHNldFNoaWZ0aW5nRmxhZyhyZWNvcmQsIGZhbHNlKVxuICAgICAgYXdhaXQgc2hpZnRQb3NpdGlvbnNEb3duKHtyZWNvcmQsIHBvc2l0aW9uQ29sdW1uLCBzY29wZSwgc2NvcGVWYWx1ZTogb2xkU2NvcGVWYWx1ZSwgZnJvbVBvc2l0aW9uOiBvbGRQb3NpdGlvbiArIDF9KVxuICAgICAgYXdhaXQgc2hpZnRQb3NpdGlvbnNVcCh7cmVjb3JkLCBwb3NpdGlvbkNvbHVtbiwgc2NvcGUsIHNjb3BlVmFsdWU6IG5ld1Njb3BlVmFsdWUsIGZyb21Qb3NpdGlvbjogbmV3UG9zaXRpb24sIGV4Y2x1ZGVSZWNvcmRJZDogcmVjb3JkLmlkKCl9KVxuICAgICAgYXdhaXQgcGxhY2VNb3ZlZFJlY29yZCh7cmVjb3JkLCBwb3NpdGlvbkNvbHVtbiwgc2NvcGUsIHNjb3BlVmFsdWU6IG5ld1Njb3BlVmFsdWUsIHBvc2l0aW9uOiBuZXdQb3NpdGlvbn0pXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBhd2FpdCBtb3ZlT3V0T2ZXYXkoe3JlY29yZCwgcG9zaXRpb25Db2x1bW4sIHNjb3BlLCBzY29wZVZhbHVlOiBvbGRTY29wZVZhbHVlfSlcbiAgICBzZXRTaGlmdGluZ0ZsYWcocmVjb3JkLCBmYWxzZSlcblxuICAgIGlmIChuZXdQb3NpdGlvbiA8IG9sZFBvc2l0aW9uKSB7XG4gICAgICBhd2FpdCBzaGlmdFBvc2l0aW9uc1VwKHtyZWNvcmQsIHBvc2l0aW9uQ29sdW1uLCBzY29wZSwgZnJvbVBvc2l0aW9uOiBuZXdQb3NpdGlvbiwgdG9Qb3NpdGlvbjogb2xkUG9zaXRpb259KVxuICAgIH0gZWxzZSBpZiAobmV3UG9zaXRpb24gPiBvbGRQb3NpdGlvbikge1xuICAgICAgYXdhaXQgc2hpZnRQb3NpdGlvbnNEb3duKHtyZWNvcmQsIHBvc2l0aW9uQ29sdW1uLCBzY29wZSwgZnJvbVBvc2l0aW9uOiBvbGRQb3NpdGlvbiArIDEsIHRvUG9zaXRpb246IG5ld1Bvc2l0aW9uICsgMX0pXG4gICAgfVxuICB9KVxuXG4gIG1vZGVsQ2xhc3MuYmVmb3JlRGVzdHJveShhc3luYyAocmVjb3JkKSA9PiB7XG4gICAgY29uc3QgcG9zaXRpb24gPSByZWNvcmQucmVhZEF0dHJpYnV0ZShwb3NpdGlvbkNvbHVtbilcblxuICAgIGlmIChwb3NpdGlvbiA9PSBudWxsKSB7XG4gICAgICBjb25zdCBtb2RlbENsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSAqLyAocmVjb3JkLmNvbnN0cnVjdG9yKVxuICAgICAgY29uc3QgcG9zQ29sdW1uID0gbW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lRm9yQXR0cmlidXRlTmFtZShwb3NpdGlvbkNvbHVtbilcblxuICAgICAgaWYgKHBvc0NvbHVtbiBpbiByZWNvcmQuX2F0dHJpYnV0ZXMpIGFzc2VydFBvc2l0aXZlUG9zaXRpb24oe3Bvc2l0aW9uLCBwb3NpdGlvbkNvbHVtbiwgcGVyc2lzdGVkOiB0cnVlfSlcbiAgICAgIHJldHVyblxuICAgIH1cbiAgICBhc3NlcnRQb3NpdGl2ZVBvc2l0aW9uKHtwb3NpdGlvbiwgcG9zaXRpb25Db2x1bW4sIHBlcnNpc3RlZDogdHJ1ZX0pXG5cbiAgICBhd2FpdCBtb3ZlT3V0T2ZXYXkoe3JlY29yZCwgcG9zaXRpb25Db2x1bW4sIHNjb3BlfSlcbiAgICBzZXRTaGlmdGluZ0ZsYWcocmVjb3JkLCBmYWxzZSlcblxuICAgIGF3YWl0IHNoaWZ0UG9zaXRpb25zRG93bih7cmVjb3JkLCBwb3NpdGlvbkNvbHVtbiwgc2NvcGUsIGZyb21Qb3NpdGlvbjogcG9zaXRpb24gKyAxfSlcbiAgfSlcbn1cblxuLyoqXG4gKiBFbmZvcmNlcyB0aGUgcHVibGljIGdhcC1sZXNzIGxpc3QgcG9zaXRpb24gaW52YXJpYW50IGJlZm9yZSBhbnkgc2hpZnRpbmcuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7bnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZH0gYXJncy5wb3NpdGlvbiAtIFBvc2l0aW9uIHRvIHZhbGlkYXRlLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucG9zaXRpb25Db2x1bW4gLSBQb3NpdGlvbiBhdHRyaWJ1dGUgbmFtZS5cbiAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MucGVyc2lzdGVkXSAtIFdoZXRoZXIgdGhlIGludmFsaWQgdmFsdWUgY2FtZSBmcm9tIHBlcnNpc3RlZCBzdGF0ZS5cbiAqIEByZXR1cm5zIHt2b2lkfVxuICovXG5mdW5jdGlvbiBhc3NlcnRQb3NpdGl2ZVBvc2l0aW9uKHtwb3NpdGlvbiwgcG9zaXRpb25Db2x1bW4sIHBlcnNpc3RlZCA9IGZhbHNlfSkge1xuICBpZiAodHlwZW9mIHBvc2l0aW9uID09PSBcIm51bWJlclwiICYmIE51bWJlci5pc0ludGVnZXIocG9zaXRpb24pICYmIHBvc2l0aW9uID4gMCkgcmV0dXJuXG5cbiAgY29uc3Qgc291cmNlID0gcGVyc2lzdGVkID8gXCJQZXJzaXN0ZWRcIiA6IFwiUmVxdWVzdGVkXCJcblxuICB0aHJvdyBuZXcgRXJyb3IoYCR7c291cmNlfSBhY3RzQXNMaXN0ICR7cG9zaXRpb25Db2x1bW59IG11c3QgYmUgYSBwb3NpdGl2ZSBpbnRlZ2VyYClcbn1cblxuLyoqXG4gKiBQbGFjZXMgYSBtb3ZlZCByb3cgYWZ0ZXIgc3Vycm91bmRpbmcgcm93cyBoYXZlIHNoaWZ0ZWQuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnJlY29yZCAtIE1vZGVsIGluc3RhbmNlLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucG9zaXRpb25Db2x1bW4gLSBQb3NpdGlvbiBhdHRyaWJ1dGUgbmFtZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjb3BlIC0gU2NvcGUgYXR0cmlidXRlIG5hbWUuXG4gKiBAcGFyYW0ge3N0cmluZyB8IG51bWJlcn0gYXJncy5zY29wZVZhbHVlIC0gRGVzdGluYXRpb24gc2NvcGUgdmFsdWUuXG4gKiBAcGFyYW0ge251bWJlcn0gYXJncy5wb3NpdGlvbiAtIERlc3RpbmF0aW9uIHBvc2l0aW9uLlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IFJlc29sdmVzIGFmdGVyIHBsYWNlbWVudC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gcGxhY2VNb3ZlZFJlY29yZCh7cmVjb3JkLCBwb3NpdGlvbkNvbHVtbiwgc2NvcGUsIHNjb3BlVmFsdWUsIHBvc2l0aW9ufSkge1xuICBjb25zdCBtb2RlbENsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSAqLyAocmVjb3JkLmNvbnN0cnVjdG9yKVxuICBjb25zdCBjb25uZWN0aW9uID0gcmVjb3JkLmNvbm5lY3Rpb24oKVxuICBjb25zdCB0YWJsZVNxbCA9IGNvbm5lY3Rpb24ucXVvdGVUYWJsZShtb2RlbENsYXNzLl9nZXRUYWJsZSgpLmdldE5hbWUoKSlcbiAgY29uc3Qgc2NvcGVDb2wgPSBtb2RlbENsYXNzLmdldENvbHVtbk5hbWVGb3JBdHRyaWJ1dGVOYW1lKHNjb3BlKVxuICBjb25zdCBwb3NDb2wgPSBtb2RlbENsYXNzLmdldENvbHVtbk5hbWVGb3JBdHRyaWJ1dGVOYW1lKHBvc2l0aW9uQ29sdW1uKVxuICBjb25zdCBwcmVzZXJ2ZWRDaGFuZ2VzID0gey4uLnJlY29yZC5fY2hhbmdlc31cbiAgY29uc3Qgc2NvcGVDb2x1bW5TcWwgPSBjb25uZWN0aW9uLnF1b3RlQ29sdW1uKHNjb3BlQ29sKVxuICBjb25zdCBwb3NpdGlvbkNvbHVtblNxbCA9IGNvbm5lY3Rpb24ucXVvdGVDb2x1bW4ocG9zQ29sKVxuICBjb25zdCBwcmltYXJ5S2V5U3FsID0gY29ubmVjdGlvbi5xdW90ZUNvbHVtbihtb2RlbENsYXNzLnByaW1hcnlLZXkoKSlcblxuICBkZWxldGUgcHJlc2VydmVkQ2hhbmdlc1tzY29wZUNvbF1cbiAgZGVsZXRlIHByZXNlcnZlZENoYW5nZXNbcG9zQ29sXVxuXG4gIGF3YWl0IGNvbm5lY3Rpb24ucXVlcnkoXG4gICAgYFVQREFURSAke3RhYmxlU3FsfSBTRVQgJHtzY29wZUNvbHVtblNxbH0gPSAke2Nvbm5lY3Rpb24ucXVvdGUoc2NvcGVWYWx1ZSl9LCAke3Bvc2l0aW9uQ29sdW1uU3FsfSA9ICR7Y29ubmVjdGlvbi5xdW90ZShwb3NpdGlvbil9IFdIRVJFICR7cHJpbWFyeUtleVNxbH0gPSAke2Nvbm5lY3Rpb24ucXVvdGUocmVjb3JkLmlkKCkpfWBcbiAgKVxuICBhd2FpdCByZWNvcmQuX3JlbG9hZFdpdGhJZChyZWNvcmQuaWQoKSlcbiAgcmVjb3JkLl9jaGFuZ2VzID0gcHJlc2VydmVkQ2hhbmdlc1xuICBjbGVhckJlbG9uZ3NUb0NoYW5nZUZvclNjb3BlKHJlY29yZClcbn1cblxuLyoqXG4gKiBDbGVhcnMgZGlydHkgYmVsb25ncy10byBzdGF0ZSBmb3IgdGhlIHNjb3BlIEZLIGFmdGVyIGRpcmVjdCBwbGFjZW1lbnQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gcmVjb3JkIC0gTW9kZWwgaW5zdGFuY2UuXG4gKiBAcmV0dXJucyB7dm9pZH0gTm90aGluZy5cbiAqL1xuZnVuY3Rpb24gY2xlYXJCZWxvbmdzVG9DaGFuZ2VGb3JTY29wZShyZWNvcmQpIHtcbiAgZm9yIChjb25zdCByZWxhdGlvbnNoaXBOYW1lIGluIHJlY29yZC5faW5zdGFuY2VSZWxhdGlvbnNoaXBzIHx8IHt9KSB7XG4gICAgY29uc3QgcmVsYXRpb25zaGlwID0gcmVjb3JkLl9pbnN0YW5jZVJlbGF0aW9uc2hpcHNbcmVsYXRpb25zaGlwTmFtZV1cblxuICAgIGlmIChyZWxhdGlvbnNoaXAuZ2V0VHlwZSgpICE9PSBcImJlbG9uZ3NUb1wiKSBjb250aW51ZVxuXG4gICAgcmVsYXRpb25zaGlwLnNldERpcnR5KGZhbHNlKVxuICB9XG59XG5cbi8qKlxuICogQnVtcHMgcG9zaXRpb25zIFVQIGJ5IDEgaW4gdGhlIHJhbmdlIFtmcm9tUG9zaXRpb24sIHRvUG9zaXRpb24pIHdpdGhpbiB0aGVcbiAqIHNhbWUgc2NvcGUuIFVwZGF0ZXMgaW4gZGVzY2VuZGluZyBvcmRlciB0byBhdm9pZCBpbnRlcm1lZGlhdGUgVU5JUVVFXG4gKiBjb25zdHJhaW50IHZpb2xhdGlvbnMuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnJlY29yZCAtIFRoZSBtb2RlbCBpbnN0YW5jZSB3aG9zZSBzY29wZSBpcyB0aGUgc291cmNlIG9mIHRydXRoLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucG9zaXRpb25Db2x1bW4gLSBjYW1lbENhc2UgcG9zaXRpb24gYXR0cmlidXRlIG5hbWUuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5zY29wZSAtIGNhbWVsQ2FzZSBzY29wZSBhdHRyaWJ1dGUgbmFtZS5cbiAqIEBwYXJhbSB7bnVtYmVyfSBhcmdzLmZyb21Qb3NpdGlvbiAtIFN0YXJ0aW5nIHBvc2l0aW9uIChpbmNsdXNpdmUpLlxuICogQHBhcmFtIHtudW1iZXJ9IFthcmdzLnRvUG9zaXRpb25dIC0gRW5kaW5nIHBvc2l0aW9uIChleGNsdXNpdmUpLlxuICogQHBhcmFtIHtzdHJpbmcgfCBudW1iZXJ9IFthcmdzLnNjb3BlVmFsdWVdIC0gRXhwbGljaXQgc2NvcGUgdmFsdWUuXG4gKiBAcGFyYW0ge3N0cmluZyB8IG51bWJlcn0gW2FyZ3MuZXhjbHVkZVJlY29yZElkXSAtIFJlY29yZCBpZCB0byBleGNsdWRlIGZyb20gc2hpZnRzLlxuICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHNoaWZ0UG9zaXRpb25zVXAoe3JlY29yZCwgcG9zaXRpb25Db2x1bW4sIHNjb3BlLCBmcm9tUG9zaXRpb24sIHRvUG9zaXRpb24sIHNjb3BlVmFsdWUsIGV4Y2x1ZGVSZWNvcmRJZH0pIHtcbiAgY29uc3QgbW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIGltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gKi8gKHJlY29yZC5jb25zdHJ1Y3RvcilcbiAgY29uc3QgY29ubmVjdGlvbiA9IHJlY29yZC5jb25uZWN0aW9uKClcbiAgY29uc3QgdGFibGVOYW1lID0gbW9kZWxDbGFzcy5fZ2V0VGFibGUoKS5nZXROYW1lKClcbiAgY29uc3QgcmVzb2x2ZWRTY29wZVZhbHVlID0gc2NvcGVWYWx1ZSAhPSBudWxsID8gc2NvcGVWYWx1ZSA6IHJlc29sdmVTY29wZVZhbHVlKHJlY29yZCwgc2NvcGUpXG4gIGNvbnN0IHNjb3BlQ29sdW1uTmFtZSA9IG1vZGVsQ2xhc3MuZ2V0Q29sdW1uTmFtZUZvckF0dHJpYnV0ZU5hbWUoc2NvcGUpXG5cbiAgaWYgKHJlc29sdmVkU2NvcGVWYWx1ZSA9PSBudWxsKSByZXR1cm5cblxuICBjb25zdCBwb3NpdGlvbkNvbHVtbk5hbWUgPSBtb2RlbENsYXNzLmdldENvbHVtbk5hbWVGb3JBdHRyaWJ1dGVOYW1lKHBvc2l0aW9uQ29sdW1uKVxuICBjb25zdCBwb3NpdGlvbkNvbHVtblNxbCA9IGNvbm5lY3Rpb24ucXVvdGVDb2x1bW4ocG9zaXRpb25Db2x1bW5OYW1lKVxuICBjb25zdCBzY29wZUNvbHVtblNxbCA9IGNvbm5lY3Rpb24ucXVvdGVDb2x1bW4oc2NvcGVDb2x1bW5OYW1lKVxuICBjb25zdCBwcmltYXJ5S2V5U3FsID0gY29ubmVjdGlvbi5xdW90ZUNvbHVtbihtb2RlbENsYXNzLnByaW1hcnlLZXkoKSlcbiAgY29uc3QgdGFibGVTcWwgPSBjb25uZWN0aW9uLnF1b3RlVGFibGUodGFibGVOYW1lKVxuICBjb25zdCBxdW90ZWRTY29wZSA9IGNvbm5lY3Rpb24ucXVvdGUocmVzb2x2ZWRTY29wZVZhbHVlKVxuXG4gIC8vIExvYWQgcm93cyBpbiBkZXNjZW5kaW5nIG9yZGVyIHNvIHdlIGJ1bXAgdGhlIGhpZ2hlc3QgZmlyc3RcbiAgbGV0IHF1ZXJ5ID0gcmVjb3JkXG4gICAgLnF1ZXJ5Rm9yTW9kZWwobW9kZWxDbGFzcylcbiAgICAuc2VsZWN0KG1vZGVsQ2xhc3MucHJpbWFyeUtleSgpKVxuICAgIC5zZWxlY3QocG9zaXRpb25Db2x1bW4pXG4gICAgLndoZXJlKHtbc2NvcGVDb2x1bW5OYW1lXTogcmVzb2x2ZWRTY29wZVZhbHVlfSlcbiAgICAud2hlcmUoYCR7cG9zaXRpb25Db2x1bW5TcWx9ID49ICR7Y29ubmVjdGlvbi5xdW90ZShmcm9tUG9zaXRpb24pfWApXG4gICAgLndoZXJlKGAke3Bvc2l0aW9uQ29sdW1uU3FsfSA+IDBgKVxuICAgIC5vcmRlcihgJHtwb3NpdGlvbkNvbHVtblNxbH0gREVTQ2ApXG5cbiAgY29uc3QgcmVjb3JkSWRUb0V4Y2x1ZGUgPSBleGNsdWRlUmVjb3JkSWQgfHwgKHJlY29yZC5pc1BlcnNpc3RlZCgpID8gcmVjb3JkLmlkKCkgOiBudWxsKVxuXG4gIGlmIChyZWNvcmRJZFRvRXhjbHVkZSAhPSBudWxsKSB7XG4gICAgcXVlcnkgPSBxdWVyeS53aGVyZShgJHtwcmltYXJ5S2V5U3FsfSAhPSAke2Nvbm5lY3Rpb24ucXVvdGUocmVjb3JkSWRUb0V4Y2x1ZGUpfWApXG4gIH1cblxuICBpZiAodG9Qb3NpdGlvbiAhPSBudWxsKSB7XG4gICAgcXVlcnkgPSBxdWVyeS53aGVyZShgJHtwb3NpdGlvbkNvbHVtblNxbH0gPCAke2Nvbm5lY3Rpb24ucXVvdGUodG9Qb3NpdGlvbil9YClcbiAgfVxuXG4gIGNvbnN0IHJvd3MgPSBhd2FpdCBxdWVyeS50b0FycmF5KClcblxuICBzZXRTaGlmdGluZ0ZsYWcocmVjb3JkLCB0cnVlKVxuXG4gIHRyeSB7XG4gICAgZm9yIChjb25zdCByb3cgb2Ygcm93cykge1xuICAgICAgY29uc3QgY3VycmVudFBvcyA9IE51bWJlcihyb3cucmVhZEF0dHJpYnV0ZShwb3NpdGlvbkNvbHVtbikpXG5cbiAgICAgIGF3YWl0IGNvbm5lY3Rpb24ucXVlcnkoXG4gICAgICAgIGBVUERBVEUgJHt0YWJsZVNxbH0gU0VUICR7cG9zaXRpb25Db2x1bW5TcWx9ID0gJHtwb3NpdGlvbkNvbHVtblNxbH0gKyAxIFdIRVJFICR7cHJpbWFyeUtleVNxbH0gPSAke2Nvbm5lY3Rpb24ucXVvdGUocm93LmlkKCkpfSBBTkQgJHtzY29wZUNvbHVtblNxbH0gPSAke3F1b3RlZFNjb3BlfSBBTkQgJHtwb3NpdGlvbkNvbHVtblNxbH0gPSAke2Nvbm5lY3Rpb24ucXVvdGUoY3VycmVudFBvcyl9YFxuICAgICAgKVxuICAgIH1cbiAgfSBmaW5hbGx5IHtcbiAgICBzZXRTaGlmdGluZ0ZsYWcocmVjb3JkLCBmYWxzZSlcbiAgfVxufVxuXG4vKipcbiAqIEJ1bXBzIHBvc2l0aW9ucyBET1dOIGJ5IDEgaW4gdGhlIHJhbmdlIFtmcm9tUG9zaXRpb24sIHRvUG9zaXRpb24pIHdpdGhpblxuICogdGhlIHNhbWUgc2NvcGUuIFVwZGF0ZXMgaW4gYXNjZW5kaW5nIG9yZGVyIHRvIGF2b2lkIGludGVybWVkaWF0ZSBVTklRVUVcbiAqIGNvbnN0cmFpbnQgdmlvbGF0aW9ucy5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gQXJndW1lbnRzLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MucmVjb3JkIC0gVGhlIG1vZGVsIGluc3RhbmNlIHdob3NlIHNjb3BlIGlzIHRoZSBzb3VyY2Ugb2YgdHJ1dGguXG4gKiBAcGFyYW0ge3N0cmluZ30gYXJncy5wb3NpdGlvbkNvbHVtbiAtIGNhbWVsQ2FzZSBwb3NpdGlvbiBhdHRyaWJ1dGUgbmFtZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnNjb3BlIC0gY2FtZWxDYXNlIHNjb3BlIGF0dHJpYnV0ZSBuYW1lLlxuICogQHBhcmFtIHtudW1iZXJ9IGFyZ3MuZnJvbVBvc2l0aW9uIC0gU3RhcnRpbmcgcG9zaXRpb24gKGluY2x1c2l2ZSkuXG4gKiBAcGFyYW0ge251bWJlcn0gW2FyZ3MudG9Qb3NpdGlvbl0gLSBFbmRpbmcgcG9zaXRpb24gKGV4Y2x1c2l2ZSkuXG4gKiBAcGFyYW0ge3N0cmluZyB8IG51bWJlcn0gW2FyZ3Muc2NvcGVWYWx1ZV0gLSBFeHBsaWNpdCBzY29wZSB2YWx1ZS5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxuICovXG5hc3luYyBmdW5jdGlvbiBzaGlmdFBvc2l0aW9uc0Rvd24oe3JlY29yZCwgcG9zaXRpb25Db2x1bW4sIHNjb3BlLCBmcm9tUG9zaXRpb24sIHRvUG9zaXRpb24sIHNjb3BlVmFsdWV9KSB7XG4gIGNvbnN0IG1vZGVsQ2xhc3MgPSAvKiogQHR5cGUge3R5cGVvZiBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9ICovIChyZWNvcmQuY29uc3RydWN0b3IpXG4gIGNvbnN0IGNvbm5lY3Rpb24gPSByZWNvcmQuY29ubmVjdGlvbigpXG4gIGNvbnN0IHRhYmxlTmFtZSA9IG1vZGVsQ2xhc3MuX2dldFRhYmxlKCkuZ2V0TmFtZSgpXG4gIGNvbnN0IHJlc29sdmVkU2NvcGVWYWx1ZSA9IHNjb3BlVmFsdWUgIT0gbnVsbCA/IHNjb3BlVmFsdWUgOiByZXNvbHZlU2NvcGVWYWx1ZShyZWNvcmQsIHNjb3BlKVxuICBjb25zdCBzY29wZUNvbHVtbk5hbWUgPSBtb2RlbENsYXNzLmdldENvbHVtbk5hbWVGb3JBdHRyaWJ1dGVOYW1lKHNjb3BlKVxuXG4gIGlmIChyZXNvbHZlZFNjb3BlVmFsdWUgPT0gbnVsbCkgcmV0dXJuXG5cbiAgY29uc3QgcG9zaXRpb25Db2x1bW5OYW1lID0gbW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lRm9yQXR0cmlidXRlTmFtZShwb3NpdGlvbkNvbHVtbilcbiAgY29uc3QgcG9zaXRpb25Db2x1bW5TcWwgPSBjb25uZWN0aW9uLnF1b3RlQ29sdW1uKHBvc2l0aW9uQ29sdW1uTmFtZSlcbiAgY29uc3Qgc2NvcGVDb2x1bW5TcWwgPSBjb25uZWN0aW9uLnF1b3RlQ29sdW1uKHNjb3BlQ29sdW1uTmFtZSlcbiAgY29uc3QgcHJpbWFyeUtleVNxbCA9IGNvbm5lY3Rpb24ucXVvdGVDb2x1bW4obW9kZWxDbGFzcy5wcmltYXJ5S2V5KCkpXG4gIGNvbnN0IHRhYmxlU3FsID0gY29ubmVjdGlvbi5xdW90ZVRhYmxlKHRhYmxlTmFtZSlcbiAgY29uc3QgcXVvdGVkU2NvcGUgPSBjb25uZWN0aW9uLnF1b3RlKHJlc29sdmVkU2NvcGVWYWx1ZSlcblxuICAvLyBMb2FkIHJvd3MgaW4gYXNjZW5kaW5nIG9yZGVyIHNvIHdlIHNoaWZ0IHRoZSBsb3dlc3QgZ2FwIGZpcnN0XG4gIGxldCBxdWVyeSA9IHJlY29yZFxuICAgIC5xdWVyeUZvck1vZGVsKG1vZGVsQ2xhc3MpXG4gICAgLnNlbGVjdChtb2RlbENsYXNzLnByaW1hcnlLZXkoKSlcbiAgICAuc2VsZWN0KHBvc2l0aW9uQ29sdW1uKVxuICAgIC53aGVyZSh7W3Njb3BlQ29sdW1uTmFtZV06IHJlc29sdmVkU2NvcGVWYWx1ZX0pXG4gICAgLndoZXJlKGAke3Bvc2l0aW9uQ29sdW1uU3FsfSA+PSAke2Nvbm5lY3Rpb24ucXVvdGUoZnJvbVBvc2l0aW9uKX1gKVxuICAgIC53aGVyZShgJHtwb3NpdGlvbkNvbHVtblNxbH0gPiAwYClcbiAgICAud2hlcmUoYCR7cHJpbWFyeUtleVNxbH0gIT0gJHtjb25uZWN0aW9uLnF1b3RlKHJlY29yZC5pZCgpKX1gKVxuICAgIC5vcmRlcih7Y29sdW1uOiBwb3NpdGlvbkNvbHVtbk5hbWUsIGRpcmVjdGlvbjogXCJBU0NcIn0pXG5cbiAgaWYgKHRvUG9zaXRpb24gIT0gbnVsbCkge1xuICAgIHF1ZXJ5ID0gcXVlcnkud2hlcmUoYCR7cG9zaXRpb25Db2x1bW5TcWx9IDwgJHtjb25uZWN0aW9uLnF1b3RlKHRvUG9zaXRpb24pfWApXG4gIH1cblxuICBjb25zdCByb3dzID0gYXdhaXQgcXVlcnkudG9BcnJheSgpXG5cbiAgc2V0U2hpZnRpbmdGbGFnKHJlY29yZCwgdHJ1ZSlcblxuICB0cnkge1xuICAgIGZvciAoY29uc3Qgcm93IG9mIHJvd3MpIHtcbiAgICAgIGNvbnN0IGN1cnJlbnRQb3MgPSBOdW1iZXIocm93LnJlYWRBdHRyaWJ1dGUocG9zaXRpb25Db2x1bW4pKVxuXG4gICAgICBhd2FpdCBjb25uZWN0aW9uLnF1ZXJ5KFxuICAgICAgICBgVVBEQVRFICR7dGFibGVTcWx9IFNFVCAke3Bvc2l0aW9uQ29sdW1uU3FsfSA9ICR7cG9zaXRpb25Db2x1bW5TcWx9IC0gMSBXSEVSRSAke3ByaW1hcnlLZXlTcWx9ID0gJHtjb25uZWN0aW9uLnF1b3RlKHJvdy5pZCgpKX0gQU5EICR7c2NvcGVDb2x1bW5TcWx9ID0gJHtxdW90ZWRTY29wZX0gQU5EICR7cG9zaXRpb25Db2x1bW5TcWx9ID0gJHtjb25uZWN0aW9uLnF1b3RlKGN1cnJlbnRQb3MpfWBcbiAgICAgIClcbiAgICB9XG4gIH0gZmluYWxseSB7XG4gICAgc2V0U2hpZnRpbmdGbGFnKHJlY29yZCwgZmFsc2UpXG4gIH1cbn1cblxuLyoqXG4gKiBSZXR1cm5zIHRoZSBoaWdoZXN0IGN1cnJlbnQgcG9zaXRpb24gdmFsdWUgaW4gdGhlIHJlY29yZCdzIHNjb3BlLlxuICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBBcmd1bWVudHMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5yZWNvcmQgLSBUaGUgbW9kZWwgaW5zdGFuY2Ugd2hvc2Ugc2NvcGUgaXMgdGhlIHNvdXJjZSBvZiB0cnV0aC5cbiAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnBvc2l0aW9uQ29sdW1uIC0gY2FtZWxDYXNlIHBvc2l0aW9uIGF0dHJpYnV0ZSBuYW1lLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc2NvcGUgLSBjYW1lbENhc2Ugc2NvcGUgYXR0cmlidXRlIG5hbWUuXG4gKiBAcGFyYW0ge3N0cmluZyB8IG51bWJlcn0gW2FyZ3Muc2NvcGVWYWx1ZV0gLSBFeHBsaWNpdCBzY29wZSB2YWx1ZS5cbiAqIEByZXR1cm5zIHtQcm9taXNlPG51bWJlcj59IC0gSGlnaGVzdCBwb3NpdGlvbiBpbiBzY29wZSwgb3IgMCB3aGVuIHNjb3BlIGlzIGVtcHR5LlxuICovXG5hc3luYyBmdW5jdGlvbiBoaWdoZXN0UG9zaXRpb25JblNjb3BlKHtyZWNvcmQsIHBvc2l0aW9uQ29sdW1uLCBzY29wZSwgc2NvcGVWYWx1ZX0pIHtcbiAgY29uc3QgbW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIGltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gKi8gKHJlY29yZC5jb25zdHJ1Y3RvcilcbiAgY29uc3QgY29ubmVjdGlvbiA9IHJlY29yZC5jb25uZWN0aW9uKClcbiAgY29uc3Qgc2NvcGVDb2x1bW5OYW1lID0gbW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lRm9yQXR0cmlidXRlTmFtZShzY29wZSlcbiAgY29uc3QgcG9zaXRpb25Db2x1bW5OYW1lID0gbW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lRm9yQXR0cmlidXRlTmFtZShwb3NpdGlvbkNvbHVtbilcbiAgY29uc3QgcG9zaXRpb25Db2x1bW5TcWwgPSBjb25uZWN0aW9uLnF1b3RlQ29sdW1uKHBvc2l0aW9uQ29sdW1uTmFtZSlcbiAgY29uc3QgcmVzb2x2ZWRTY29wZVZhbHVlID0gc2NvcGVWYWx1ZSAhPSBudWxsID8gc2NvcGVWYWx1ZSA6IHJlc29sdmVTY29wZVZhbHVlKHJlY29yZCwgc2NvcGUpXG5cbiAgaWYgKHJlc29sdmVkU2NvcGVWYWx1ZSA9PSBudWxsKSByZXR1cm4gMFxuXG4gIGNvbnN0IHJvd3MgPSBhd2FpdCByZWNvcmRcbiAgICAucXVlcnlGb3JNb2RlbChtb2RlbENsYXNzKVxuICAgIC5zZWxlY3QocG9zaXRpb25Db2x1bW4pXG4gICAgLndoZXJlKHtbc2NvcGVDb2x1bW5OYW1lXTogcmVzb2x2ZWRTY29wZVZhbHVlfSlcbiAgICAub3JkZXIoYCR7cG9zaXRpb25Db2x1bW5TcWx9IERFU0NgKVxuICAgIC5saW1pdCgxKVxuICAgIC50b0FycmF5KClcblxuICBpZiAocm93cy5sZW5ndGggPT09IDApIHJldHVybiAwXG5cbiAgcmV0dXJuIE51bWJlcihyb3dzWzBdLnJlYWRBdHRyaWJ1dGUocG9zaXRpb25Db2x1bW4pKSB8fCAwXG59XG5cbi8qKlxuICogUmVzb2x2ZXMgYSBzY29wZSB2YWx1ZSBmcm9tIHRoZSBhdHRyaWJ1dGUgc3RvcmUgZmlyc3QsIHRoZW4gZmFsbHMgYmFja1xuICogdG8gdGhlIGxvYWRlZCBiZWxvbmdzVG8gcmVsYXRpb25zaGlwLiBUaGlzIGlzIG5lZWRlZCBkdXJpbmcgYmVmb3JlQ3JlYXRlXG4gKiBiZWNhdXNlIHRoZSBGSyBhdHRyaWJ1dGUgbWF5IG5vdCBiZSBzZXQgdW50aWwgX2NyZWF0ZU5ld1JlY29yZCBmbHVzaGVzXG4gKiBfYmVsb25nc1RvQ2hhbmdlcy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSByZWNvcmQgLSBNb2RlbCBpbnN0YW5jZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBzY29wZSAtIGNhbWVsQ2FzZSBzY29wZSBhdHRyaWJ1dGUgbmFtZSAoZS5nLiBcInByb2plY3RJZFwiKS5cbiAqIEByZXR1cm5zIHtzdHJpbmcgfCBudW1iZXIgfCBudWxsfSAtIEN1cnJlbnQgbGlzdCBwb3NpdGlvbiB2YWx1ZS5cbiAqL1xuZnVuY3Rpb24gcmVzb2x2ZVNjb3BlVmFsdWUocmVjb3JkLCBzY29wZSkge1xuICBjb25zdCBhdHRyVmFsdWUgPSByZWNvcmQucmVhZEF0dHJpYnV0ZShzY29wZSlcblxuICBpZiAoYXR0clZhbHVlICE9IG51bGwpIHJldHVybiAvKiogQHR5cGUge3N0cmluZyB8IG51bWJlcn0gKi8gKGF0dHJWYWx1ZSlcblxuICBjb25zdCBtb2RlbENsYXNzID0gLyoqIEB0eXBlIHt0eXBlb2YgaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSAqLyAocmVjb3JkLmNvbnN0cnVjdG9yKVxuICBjb25zdCByZWxhdGlvbnNoaXBzID0gbW9kZWxDbGFzcy5nZXRSZWxhdGlvbnNoaXBzTWFwKClcbiAgY29uc3Qgc2NvcGVDb2x1bW5OYW1lID0gbW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lRm9yQXR0cmlidXRlTmFtZShzY29wZSlcblxuICBmb3IgKGNvbnN0IHJlbGF0aW9uc2hpcE5hbWUgaW4gcmVsYXRpb25zaGlwcykge1xuICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IHJlbGF0aW9uc2hpcHNbcmVsYXRpb25zaGlwTmFtZV1cblxuICAgIGlmIChyZWxhdGlvbnNoaXAuZ2V0VHlwZT8uKCkgIT09IFwiYmVsb25nc1RvXCIpIGNvbnRpbnVlXG5cbiAgICBjb25zdCBmb3JlaWduS2V5ID0gcmVsYXRpb25zaGlwLmdldEZvcmVpZ25LZXkoKVxuXG4gICAgaWYgKGZvcmVpZ25LZXkgIT09IHNjb3BlQ29sdW1uTmFtZSkgY29udGludWVcblxuICAgIGNvbnN0IGluc3RhbmNlUmVsYXRpb25zaGlwID0gcmVjb3JkLmdldFJlbGF0aW9uc2hpcEJ5TmFtZShyZWxhdGlvbnNoaXBOYW1lKVxuICAgIGNvbnN0IGxvYWRlZCA9IGluc3RhbmNlUmVsYXRpb25zaGlwLmxvYWRlZCgpXG5cbiAgICBpZiAobG9hZGVkICYmICFBcnJheS5pc0FycmF5KGxvYWRlZCkgJiYgdHlwZW9mIGxvYWRlZC5pZCA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICByZXR1cm4gbG9hZGVkLmlkKClcbiAgICB9XG4gIH1cblxuICByZXR1cm4gbnVsbFxufVxuXG4vKipcbiAqIE1vdmVzIHRoZSByZWNvcmQgdG8gYSB0ZW1wb3JhcnkgcG9zaXRpb24gb3V0c2lkZSB0aGUgbm9ybWFsIHJhbmdlIHNvXG4gKiB0aGF0IHN1cnJvdW5kaW5nIHBvc2l0aW9uIHNoaWZ0cyBkbyBub3QgaGl0IHVuaXF1ZSBjb25zdHJhaW50IHZpb2xhdGlvbnMuXG4gKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIEFyZ3VtZW50cy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnJlY29yZCAtIE1vZGVsIGluc3RhbmNlLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MucG9zaXRpb25Db2x1bW4gLSBjYW1lbENhc2UgcG9zaXRpb24gYXR0cmlidXRlLlxuICogQHBhcmFtIHtzdHJpbmd9IGFyZ3Muc2NvcGUgLSBjYW1lbENhc2Ugc2NvcGUgYXR0cmlidXRlLlxuICogQHBhcmFtIHtzdHJpbmcgfCBudW1iZXIgfCBudWxsfSBbYXJncy5zY29wZVZhbHVlXSAtIFNjb3BlIGNvbnRhaW5pbmcgdGhlIHJlY29yZCBiZWZvcmUgbW92ZS1vdXQuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cbiAqL1xuYXN5bmMgZnVuY3Rpb24gbW92ZU91dE9mV2F5KHtyZWNvcmQsIHBvc2l0aW9uQ29sdW1uLCBzY29wZSwgc2NvcGVWYWx1ZX0pIHtcbiAgY29uc3QgbW9kZWxDbGFzcyA9IC8qKiBAdHlwZSB7dHlwZW9mIGltcG9ydChcIi4vaW5kZXguanNcIikuZGVmYXVsdH0gKi8gKHJlY29yZC5jb25zdHJ1Y3RvcilcbiAgY29uc3QgY29ubmVjdGlvbiA9IHJlY29yZC5jb25uZWN0aW9uKClcbiAgY29uc3QgdGFibGVOYW1lID0gbW9kZWxDbGFzcy5fZ2V0VGFibGUoKS5nZXROYW1lKClcbiAgY29uc3QgcmVzb2x2ZWRTY29wZVZhbHVlID0gc2NvcGVWYWx1ZSAhPSBudWxsID8gc2NvcGVWYWx1ZSA6IHJlc29sdmVTY29wZVZhbHVlKHJlY29yZCwgc2NvcGUpXG5cbiAgaWYgKHJlc29sdmVkU2NvcGVWYWx1ZSA9PSBudWxsKSByZXR1cm5cblxuICBjb25zdCBwb3NpdGlvbkNvbHVtblNxbCA9IGNvbm5lY3Rpb24ucXVvdGVDb2x1bW4obW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lRm9yQXR0cmlidXRlTmFtZShwb3NpdGlvbkNvbHVtbikpXG4gIGNvbnN0IHNjb3BlQ29sdW1uU3FsID0gY29ubmVjdGlvbi5xdW90ZUNvbHVtbihtb2RlbENsYXNzLmdldENvbHVtbk5hbWVGb3JBdHRyaWJ1dGVOYW1lKHNjb3BlKSlcbiAgY29uc3QgdGFibGVTcWwgPSBjb25uZWN0aW9uLnF1b3RlVGFibGUodGFibGVOYW1lKVxuICBjb25zdCBwa1NxbCA9IGNvbm5lY3Rpb24ucXVvdGVDb2x1bW4obW9kZWxDbGFzcy5wcmltYXJ5S2V5KCkpXG5cbiAgc2V0U2hpZnRpbmdGbGFnKHJlY29yZCwgdHJ1ZSlcblxuICB0cnkge1xuICAgIGF3YWl0IGNvbm5lY3Rpb24ucXVlcnkoXG4gICAgICBgVVBEQVRFICR7dGFibGVTcWx9IFNFVCAke3Bvc2l0aW9uQ29sdW1uU3FsfSA9IC0ke3Bvc2l0aW9uQ29sdW1uU3FsfSBXSEVSRSAke3Njb3BlQ29sdW1uU3FsfSA9ICR7Y29ubmVjdGlvbi5xdW90ZShyZXNvbHZlZFNjb3BlVmFsdWUpfSBBTkQgJHtwa1NxbH0gPSAke2Nvbm5lY3Rpb24ucXVvdGUocmVjb3JkLmlkKCkpfWBcbiAgICApXG4gIH0gZmluYWxseSB7XG4gICAgLy8gRG9uJ3QgY2xlYXIgdGhlIGZsYWcgaGVyZSDigJQgdGhlIGNhbGxlciB3aWxsIGRvIHRoYXQgYWZ0ZXIgc2hpZnRzXG4gIH1cbn1cbiJdfQ==