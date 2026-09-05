// @ts-check
import * as inflection from "inflection";
import { isPlainObject } from "is-plain-object";
import WhereBase from "./where-base.js";
/**
 * No match.
 * @typedef {{[key: string]: string | number | boolean | null | Array<string | number | boolean | null> | Record<string, ReturnType<typeof JSON.parse>>}} WhereHash
 */
const NO_MATCH = Symbol("no-match");
const relationshipWhereOperators = new Set(["eq", "notEq", "gt", "gteq", "lt", "lteq", "like", ">", ">=", "<", "<="]);
/**
 * Runs normalize relationship where operator.
 * @param {string} operator - Raw relationship where operator.
 * @returns {"eq" | "notEq" | "gt" | "gteq" | "lt" | "lteq" | "like"} - Normalized operator.
 */
function normalizeRelationshipWhereOperator(operator) {
    const operatorAliases = {
        "<": "lt",
        "<=": "lteq",
        ">": "gt",
        ">=": "gteq"
    };
    return /** @type {"eq" | "notEq" | "gt" | "gteq" | "lt" | "lteq" | "like"} */ (operatorAliases[ /** @type {"<" | "<=" | ">" | ">="} */(operator)] || operator);
}
export default class VelociousDatabaseQueryWhereModelClassHash extends WhereBase {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("./index.js").default} args.query - Query instance.
     * @param {WhereHash} args.hash - Hash.
     * @param {typeof import("../record/index.js").default} args.modelClass - Model class.
     * @param {boolean} [args.qualifyBaseTable] - Whether to qualify base table columns.
     */
    constructor({ query, hash, modelClass, qualifyBaseTable = false }) {
        super();
        this.hash = hash;
        this.modelClass = modelClass;
        this.qualifyBaseTable = qualifyBaseTable;
        this.query = query;
    }
    /**
     * Runs get model class.
     * @returns {typeof import("../record/index.js").default} - The model class.
     */
    getModelClass() {
        if (!this.modelClass)
            throw new Error("modelClass not set");
        return this.modelClass;
    }
    /**
     * Runs to sql.
     * @returns {string} - SQL string.
     */
    toSql() {
        let sql = "(";
        const modelQuery = /** @type {import("./model-class-query.js").default} */ (this.query);
        const baseTableName = this.qualifyBaseTable
            ? modelQuery.getTableReferenceForJoin()
            : undefined;
        sql += this._whereSQLFromHash(this.hash, this.getModelClass(), [], baseTableName);
        sql += ")";
        return sql;
    }
    /**
     * Runs resolve column name.
     * @param {typeof import("../record/index.js").default} modelClass - Model class.
     * @param {string} key - Attribute or column name.
     * @returns {string | undefined} - The resolved column name.
     */
    _resolveColumnName(modelClass, key) {
        const attributeMap = modelClass.getAttributeNameToColumnNameMap();
        if (attributeMap[key])
            return attributeMap[key];
        const columnMap = modelClass.getColumnNameToAttributeNameMap();
        const underscored = inflection.underscore(key);
        if (columnMap[key])
            return key;
        if (columnMap[underscored])
            return underscored;
        return undefined;
    }
    /**
     * Runs get relationship.
     * @param {typeof import("../record/index.js").default} modelClass - Model class.
     * @param {string} relationshipName - Relationship name.
     * @returns {import("../record/relationships/base.js").default | undefined} - The relationship.
     */
    _getRelationship(modelClass, relationshipName) {
        return modelClass.getRelationshipsMap()[relationshipName];
    }
    /**
     * Runs is relationship where operator tuple.
     * @param {ReturnType<typeof JSON.parse>} tupleValue - Candidate tuple.
     * @returns {boolean} - Whether this is a relationship where tuple.
     */
    _isRelationshipWhereOperatorTuple(tupleValue) {
        if (!Array.isArray(tupleValue) || tupleValue.length < 3) {
            return false;
        }
        return typeof tupleValue[0] === "string" &&
            typeof tupleValue[1] === "string" &&
            relationshipWhereOperators.has(tupleValue[1]);
    }
    /**
     * Runs normalize relationship where operator tuples.
     * @param {ReturnType<typeof JSON.parse>} value - Candidate relationship where value.
     * @returns {Array<[string, "eq" | "notEq" | "gt" | "gteq" | "lt" | "lteq" | "like", unknown]>} - Normalized tuples.
     */
    _normalizeRelationshipWhereOperatorTuples(value) {
        if (!Array.isArray(value)) {
            throw new Error(`Invalid relationship where tuple container type: ${typeof value}`);
        }
        /**
         * Normalized.
         * @type {Array<[string, "eq" | "notEq" | "gt" | "gteq" | "lt" | "lteq" | "like", unknown]>} */
        const normalized = [];
        /**
         * Add condition.
         * @param {ReturnType<typeof JSON.parse>} conditionValue - Candidate nested condition.
         */
        const addCondition = (conditionValue) => {
            if (this._isRelationshipWhereOperatorTuple(conditionValue)) {
                const tuple = /** @type {[string, "eq" | "notEq" | "gt" | "gteq" | "lt" | "lteq" | "like" | ">" | ">=" | "<" | "<=", unknown, ...Array<unknown>]} */ (conditionValue);
                const normalizedOperator = normalizeRelationshipWhereOperator(tuple[1]);
                normalized.push([
                    tuple[0],
                    normalizedOperator,
                    tuple[2]
                ]);
                if (tuple.length > 3) {
                    for (let index = 3; index < tuple.length; index += 1) {
                        addCondition(tuple[index]);
                    }
                }
                return;
            }
            if (!Array.isArray(conditionValue)) {
                throw new Error("Relationship where conditions must be tuples");
            }
            conditionValue.forEach((nestedConditionValue) => {
                addCondition(nestedConditionValue);
            });
        };
        addCondition(value);
        if (normalized.length < 1) {
            throw new Error("Relationship where tuple container cannot be empty");
        }
        return normalized;
    }
    /**
     * Runs is relationship where operator tuple container.
     * @param {ReturnType<typeof JSON.parse>} value - Candidate relationship where value.
     * @returns {boolean} - Whether value can be normalized to relationship tuples.
     */
    _isRelationshipWhereOperatorTupleContainer(value) {
        try {
            this._normalizeRelationshipWhereOperatorTuples(value);
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Runs where sqlfrom relationship where operator tuples.
     * @param {object} args - Relationship where options.
     * @param {typeof import("../record/index.js").default} args.modelClass - Relationship model class.
     * @param {string} args.tableName - Relationship table reference name.
     * @param {Array<[string, "eq" | "notEq" | "gt" | "gteq" | "lt" | "lteq" | "like", unknown]>} args.tuples - Operator tuples.
     * @returns {string} - SQL where fragment.
     */
    _whereSQLFromRelationshipWhereOperatorTuples({ modelClass, tableName, tuples }) {
        const options = this.getOptions();
        let sql = "";
        let index = 0;
        tuples.forEach(([attributeName, operator, whereValue]) => {
            if (index > 0)
                sql += " AND ";
            const columnName = this._resolveColumnName(modelClass, attributeName);
            if (!columnName)
                throw new Error(`Unknown attribute "${attributeName}" for ${modelClass.name}`);
            const normalizedValue = this._normalizeSqliteBooleanValue({
                columnName,
                modelClass,
                value: whereValue
            });
            const typedValue = this._normalizeValueForColumnType({
                columnName,
                modelClass,
                value: normalizedValue
            });
            const columnType = modelClass.getColumnTypeByName(columnName);
            const driverType = this.getQuery().driver.getType();
            if (typedValue === NO_MATCH) {
                if (operator === "notEq") {
                    sql += "1=1";
                }
                else {
                    sql += "1=0";
                }
                index += 1;
                return;
            }
            let columnSql = `${options.quoteTableName(tableName)}.${options.quoteColumnName(columnName)}`;
            if (driverType == "mssql" && typeof whereValue === "string" && columnType?.toLowerCase() == "text") {
                columnSql = `CAST(${columnSql} AS NVARCHAR(MAX))`;
            }
            if (operator === "eq") {
                if (Array.isArray(typedValue)) {
                    if (typedValue.length < 1) {
                        sql += "1=0";
                    }
                    else {
                        sql += `${columnSql} IN (${typedValue.map((value) => options.quote(value)).join(", ")})`;
                    }
                }
                else if (typedValue === null) {
                    sql += `${columnSql} IS NULL`;
                }
                else {
                    sql += `${columnSql} = ${options.quote(typedValue)}`;
                }
                index += 1;
                return;
            }
            if (operator === "notEq") {
                if (Array.isArray(typedValue)) {
                    if (typedValue.length < 1) {
                        sql += "1=1";
                    }
                    else {
                        sql += `${columnSql} NOT IN (${typedValue.map((value) => options.quote(value)).join(", ")})`;
                    }
                }
                else if (typedValue === null) {
                    sql += `${columnSql} IS NOT NULL`;
                }
                else {
                    sql += `${columnSql} != ${options.quote(typedValue)}`;
                }
                index += 1;
                return;
            }
            if (Array.isArray(typedValue)) {
                throw new Error(`Operator "${operator}" does not support array values for ${modelClass.name}.${attributeName}`);
            }
            if (typedValue === null) {
                throw new Error(`Operator "${operator}" does not support null values for ${modelClass.name}.${attributeName}`);
            }
            const operatorMap = {
                gt: ">",
                gteq: ">=",
                like: "LIKE",
                lt: "<",
                lteq: "<="
            };
            sql += `${columnSql} ${operatorMap[operator]} ${options.quote(typedValue)}`;
            index += 1;
        });
        return sql;
    }
    /**
     * Runs normalize sqlite boolean value.
     * @param {object} args - Options object.
     * @param {typeof import("../record/index.js").default} args.modelClass - Model class.
     * @param {string} args.columnName - Column name.
     * @param {ReturnType<typeof JSON.parse>} args.value - Value to normalize.
     * @returns {ReturnType<typeof JSON.parse>} - Normalized value.
     */
    _normalizeSqliteBooleanValue({ modelClass, columnName, value }) {
        if (modelClass.getDatabaseType() != "sqlite")
            return value;
        const columnType = modelClass.getColumnTypeByName(columnName);
        if (!columnType)
            return value;
        if (columnType.toLowerCase() !== "boolean")
            return value;
        /**
         * Normalize.
         * @param {ReturnType<typeof JSON.parse>} entry - Value to normalize.
         * @returns {ReturnType<typeof JSON.parse>} - SQLite predicate value with booleans encoded as 1 or 0.
         */
        const normalize = (entry) => {
            if (entry === true)
                return 1;
            if (entry === false)
                return 0;
            return entry;
        };
        if (Array.isArray(value)) {
            return value.map((entry) => normalize(entry));
        }
        return normalize(value);
    }
    /**
     * Runs normalize value for column type.
     * @param {object} args - Options object.
     * @param {typeof import("../record/index.js").default} args.modelClass - Model class.
     * @param {string} args.columnName - Column name.
     * @param {ReturnType<typeof JSON.parse>} args.value - Value to normalize.
     * @returns {ReturnType<typeof JSON.parse>} - Normalized value.
     */
    _normalizeValueForColumnType({ modelClass, columnName, value }) {
        const columnType = modelClass.getColumnTypeByName(columnName);
        if (!columnType)
            return value;
        const normalizedType = columnType.toLowerCase();
        const stringTypes = new Set(["char", "varchar", "nvarchar", "string", "enum", "json", "jsonb", "citext", "binary", "varbinary"]);
        const isUuidType = normalizedType.includes("uuid");
        const shouldCoerceToString = normalizedType.includes("uuid") ||
            normalizedType.includes("text") ||
            stringTypes.has(normalizedType);
        /**
         * Normalize.
         * @param {ReturnType<typeof JSON.parse>} entry - Value to normalize.
         * @returns {ReturnType<typeof JSON.parse>} - Column-compatible predicate value, or the no-match sentinel for numeric UUIDs.
         */
        const normalize = (entry) => {
            if (isUuidType && typeof entry === "number")
                return NO_MATCH;
            if (!shouldCoerceToString || typeof entry !== "number")
                return entry;
            return String(entry);
        };
        if (Array.isArray(value)) {
            const normalized = value.map((entry) => normalize(entry)).filter((entry) => entry !== NO_MATCH);
            if (isUuidType && normalized.length === 0)
                return NO_MATCH;
            return normalized;
        }
        const normalized = normalize(value);
        if (normalized === NO_MATCH)
            return NO_MATCH;
        return normalized;
    }
    /**
     * Runs where sqlfrom hash.
     * @param {WhereHash} hash - Hash.
     * @param {typeof import("../record/index.js").default} modelClass - Model class.
     * @param {string[]} path - Join path.
     * @param {string} [tableName] - Table name.
     * @param {number} index - Index value.
     * @returns {string} - SQL string.
     */
    _whereSQLFromHash(hash, modelClass, path, tableName, index = 0) {
        const options = this.getOptions();
        const modelQuery = /** @type {import("./model-class-query.js").default} */ (this.query);
        let sql = "";
        for (const whereKey in hash) {
            const whereValue = hash[whereKey];
            const relationship = this._getRelationship(modelClass, whereKey);
            const tuples = this._isRelationshipWhereOperatorTupleContainer(whereValue)
                ? this._normalizeRelationshipWhereOperatorTuples(whereValue)
                : null;
            const resolvedColumnName = this._resolveColumnName(modelClass, whereKey);
            if (relationship && tuples) {
                if (index > 0)
                    sql += " AND ";
                const rawTargetModelClass = relationship.getTargetModelClass();
                if (!rawTargetModelClass)
                    throw new Error(`Relationship "${whereKey}" for ${modelClass.name} has no target model class`);
                const targetModelClass = modelClass.bindRecordMetadataModelClass(rawTargetModelClass);
                const nestedPath = path.concat([whereKey]);
                const nestedTableName = modelQuery.getTableReferenceForJoin(...nestedPath);
                sql += this._whereSQLFromRelationshipWhereOperatorTuples({
                    modelClass: targetModelClass,
                    tableName: nestedTableName,
                    tuples
                });
            }
            else if (resolvedColumnName && tuples) {
                if (index > 0)
                    sql += " AND ";
                sql += this._whereSQLFromRelationshipWhereOperatorTuples({
                    modelClass,
                    tableName: tableName || modelQuery.getTableReferenceForJoin(...path),
                    tuples
                });
            }
            else if (Array.isArray(whereValue) && whereValue.length === 0) {
                if (index > 0)
                    sql += " AND ";
                sql += "1=0";
            }
            else if (isPlainObject(whereValue)) {
                if (!relationship) {
                    throw new Error(`Unknown relationship "${whereKey}" for ${modelClass.name}`);
                }
                const rawTargetModelClass = relationship.getTargetModelClass();
                if (!rawTargetModelClass)
                    throw new Error(`Relationship "${whereKey}" for ${modelClass.name} has no target model class`);
                const targetModelClass = modelClass.bindRecordMetadataModelClass(rawTargetModelClass);
                const nestedHash = /** @type {WhereHash} */ (whereValue);
                const nestedPath = path.concat([whereKey]);
                const nestedTableName = modelQuery.getTableReferenceForJoin(...nestedPath);
                sql += this._whereSQLFromHash(nestedHash, targetModelClass, nestedPath, nestedTableName, index);
            }
            else {
                if (index > 0)
                    sql += " AND ";
                const columnName = this._resolveColumnName(modelClass, whereKey);
                if (!columnName)
                    throw new Error(`Unknown attribute "${whereKey}" for ${modelClass.name}`);
                const columnType = modelClass.getColumnTypeByName(columnName);
                const normalizedValue = this._normalizeSqliteBooleanValue({
                    columnName,
                    modelClass,
                    value: whereValue
                });
                const typedValue = this._normalizeValueForColumnType({
                    columnName,
                    modelClass,
                    value: normalizedValue
                });
                if (typedValue === NO_MATCH) {
                    sql += "1=0";
                    index++;
                    continue;
                }
                let columnSql = `${options.quoteColumnName(columnName)}`;
                if (tableName) {
                    columnSql = `${options.quoteTableName(tableName)}.${columnSql}`;
                }
                const driverType = this.getQuery().driver.getType();
                if (driverType == "mssql" && typeof whereValue === "string" && columnType?.toLowerCase() == "text") {
                    columnSql = `CAST(${columnSql} AS NVARCHAR(MAX))`;
                }
                sql += columnSql;
                if (Array.isArray(typedValue)) {
                    sql += ` IN (${typedValue.map((value) => options.quote(value)).join(", ")})`;
                }
                else if (typedValue === null) {
                    sql += " IS NULL";
                }
                else {
                    sql += ` = ${options.quote(typedValue)}`;
                }
            }
            index++;
        }
        return sql;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2hlcmUtbW9kZWwtY2xhc3MtaGFzaC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9xdWVyeS93aGVyZS1tb2RlbC1jbGFzcy1oYXNoLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEtBQUssVUFBVSxNQUFNLFlBQVksQ0FBQTtBQUN4QyxPQUFPLEVBQUMsYUFBYSxFQUFDLE1BQU0saUJBQWlCLENBQUE7QUFDN0MsT0FBTyxTQUFTLE1BQU0saUJBQWlCLENBQUE7QUFFdkM7OztHQUdHO0FBRUgsTUFBTSxRQUFRLEdBQUcsTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFBO0FBQ25DLE1BQU0sMEJBQTBCLEdBQUcsSUFBSSxHQUFHLENBQUMsQ0FBQyxJQUFJLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFFLE1BQU0sRUFBRSxNQUFNLEVBQUUsR0FBRyxFQUFFLElBQUksRUFBRSxHQUFHLEVBQUUsSUFBSSxDQUFDLENBQUMsQ0FBQTtBQUVySDs7OztHQUlHO0FBQ0gsU0FBUyxrQ0FBa0MsQ0FBQyxRQUFRO0lBQ2xELE1BQU0sZUFBZSxHQUFHO1FBQ3RCLEdBQUcsRUFBRSxJQUFJO1FBQ1QsSUFBSSxFQUFFLE1BQU07UUFDWixHQUFHLEVBQUUsSUFBSTtRQUNULElBQUksRUFBRSxNQUFNO0tBQ2IsQ0FBQTtJQUVELE9BQU8sc0VBQXNFLENBQUMsQ0FDNUUsZUFBZSxFQUFDLHNDQUF1QyxDQUFDLFFBQVEsQ0FBQyxDQUFDLElBQUksUUFBUSxDQUMvRSxDQUFBO0FBQ0gsQ0FBQztBQUVELE1BQU0sQ0FBQyxPQUFPLE9BQU8seUNBQTBDLFNBQVEsU0FBUztJQUM5RTs7Ozs7OztPQU9HO0lBQ0gsWUFBWSxFQUFDLEtBQUssRUFBRSxJQUFJLEVBQUUsVUFBVSxFQUFFLGdCQUFnQixHQUFHLEtBQUssRUFBQztRQUM3RCxLQUFLLEVBQUUsQ0FBQTtRQUNQ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UUFBUSxJQUFJLFVBQVUsRUFBRSxXQUFXLEVBQUUsSUFBSSxNQUFNLEVBQUUsQ0FBQztvQkFDbkcsU0FBUyxHQUFHLFFBQVEsU0FBUyxvQkFBb0IsQ0FBQTtnQkFDbkQsQ0FBQztnQkFFRCxHQUFHLElBQUksU0FBUyxDQUFBO2dCQUVoQixJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQztvQkFDOUIsR0FBRyxJQUFJLFFBQVEsVUFBVSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFBO2dCQUM5RSxDQUFDO3FCQUFNLElBQUksVUFBVSxLQUFLLElBQUksRUFBRSxDQUFDO29CQUMvQixHQUFHLElBQUksVUFBVSxDQUFBO2dCQUNuQixDQUFDO3FCQUFNLENBQUM7b0JBQ04sR0FBRyxJQUFJLE1BQU0sT0FBTyxDQUFDLEtBQUssQ0FBQyxVQUFVLENBQUMsRUFBRSxDQUFBO2dCQUMxQyxDQUFDO1lBQ0gsQ0FBQztZQUVELEtBQUssRUFBRSxDQUFBO1FBQ1QsQ0FBQztRQUVELE9BQU8sR0FBRyxDQUFBO0lBQ1osQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCAqIGFzIGluZmxlY3Rpb24gZnJvbSBcImluZmxlY3Rpb25cIlxuaW1wb3J0IHtpc1BsYWluT2JqZWN0fSBmcm9tIFwiaXMtcGxhaW4tb2JqZWN0XCJcbmltcG9ydCBXaGVyZUJhc2UgZnJvbSBcIi4vd2hlcmUtYmFzZS5qc1wiXG5cbi8qKlxuICogTm8gbWF0Y2guXG4gKiBAdHlwZWRlZiB7e1trZXk6IHN0cmluZ106IHN0cmluZyB8IG51bWJlciB8IGJvb2xlYW4gfCBudWxsIHwgQXJyYXk8c3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbiB8IG51bGw+IHwgUmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fX0gV2hlcmVIYXNoXG4gKi9cblxuY29uc3QgTk9fTUFUQ0ggPSBTeW1ib2woXCJuby1tYXRjaFwiKVxuY29uc3QgcmVsYXRpb25zaGlwV2hlcmVPcGVyYXRvcnMgPSBuZXcgU2V0KFtcImVxXCIsIFwibm90RXFcIiwgXCJndFwiLCBcImd0ZXFcIiwgXCJsdFwiLCBcImx0ZXFcIiwgXCJsaWtlXCIsIFwiPlwiLCBcIj49XCIsIFwiPFwiLCBcIjw9XCJdKVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIHJlbGF0aW9uc2hpcCB3aGVyZSBvcGVyYXRvci5cbiAqIEBwYXJhbSB7c3RyaW5nfSBvcGVyYXRvciAtIFJhdyByZWxhdGlvbnNoaXAgd2hlcmUgb3BlcmF0b3IuXG4gKiBAcmV0dXJucyB7XCJlcVwiIHwgXCJub3RFcVwiIHwgXCJndFwiIHwgXCJndGVxXCIgfCBcImx0XCIgfCBcImx0ZXFcIiB8IFwibGlrZVwifSAtIE5vcm1hbGl6ZWQgb3BlcmF0b3IuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZVJlbGF0aW9uc2hpcFdoZXJlT3BlcmF0b3Iob3BlcmF0b3IpIHtcbiAgY29uc3Qgb3BlcmF0b3JBbGlhc2VzID0ge1xuICAgIFwiPFwiOiBcImx0XCIsXG4gICAgXCI8PVwiOiBcImx0ZXFcIixcbiAgICBcIj5cIjogXCJndFwiLFxuICAgIFwiPj1cIjogXCJndGVxXCJcbiAgfVxuXG4gIHJldHVybiAvKiogQHR5cGUge1wiZXFcIiB8IFwibm90RXFcIiB8IFwiZ3RcIiB8IFwiZ3RlcVwiIHwgXCJsdFwiIHwgXCJsdGVxXCIgfCBcImxpa2VcIn0gKi8gKFxuICAgIG9wZXJhdG9yQWxpYXNlc1svKiogQHR5cGUge1wiPFwiIHwgXCI8PVwiIHwgXCI+XCIgfCBcIj49XCJ9ICovIChvcGVyYXRvcildIHx8IG9wZXJhdG9yXG4gIClcbn1cblxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgVmVsb2Npb3VzRGF0YWJhc2VRdWVyeVdoZXJlTW9kZWxDbGFzc0hhc2ggZXh0ZW5kcyBXaGVyZUJhc2Uge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MucXVlcnkgLSBRdWVyeSBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtXaGVyZUhhc2h9IGFyZ3MuaGFzaCAtIEhhc2guXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtib29sZWFufSBbYXJncy5xdWFsaWZ5QmFzZVRhYmxlXSAtIFdoZXRoZXIgdG8gcXVhbGlmeSBiYXNlIHRhYmxlIGNvbHVtbnMuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7cXVlcnksIGhhc2gsIG1vZGVsQ2xhc3MsIHF1YWxpZnlCYXNlVGFibGUgPSBmYWxzZX0pIHtcbiAgICBzdXBlcigpXG4gICAgdGhpcy5oYXNoID0gaGFzaFxuICAgIHRoaXMubW9kZWxDbGFzcyA9IG1vZGVsQ2xhc3NcbiAgICB0aGlzLnF1YWxpZnlCYXNlVGFibGUgPSBxdWFsaWZ5QmFzZVRhYmxlXG4gICAgdGhpcy5xdWVyeSA9IHF1ZXJ5XG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbW9kZWwgY2xhc3MuXG4gICAqIEByZXR1cm5zIHt0eXBlb2YgaW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IC0gVGhlIG1vZGVsIGNsYXNzLlxuICAgKi9cbiAgZ2V0TW9kZWxDbGFzcygpIHtcbiAgICBpZiAoIXRoaXMubW9kZWxDbGFzcykgdGhyb3cgbmV3IEVycm9yKFwibW9kZWxDbGFzcyBub3Qgc2V0XCIpXG5cbiAgICByZXR1cm4gdGhpcy5tb2RlbENsYXNzXG4gIH1cblxuICAvKipcbiAgICogUnVucyB0byBzcWwuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIHN0cmluZy5cbiAgICovXG4gIHRvU3FsKCkge1xuICAgIGxldCBzcWwgPSBcIihcIlxuXG4gICAgY29uc3QgbW9kZWxRdWVyeSA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0fSAqLyAodGhpcy5xdWVyeSlcbiAgICBjb25zdCBiYXNlVGFibGVOYW1lID0gdGhpcy5xdWFsaWZ5QmFzZVRhYmxlXG4gICAgICA/IG1vZGVsUXVlcnkuZ2V0VGFibGVSZWZlcmVuY2VGb3JKb2luKClcbiAgICAgIDogdW5kZWZpbmVkXG5cbiAgICBzcWwgKz0gdGhpcy5fd2hlcmVTUUxGcm9tSGFzaCh0aGlzLmhhc2gsIHRoaXMuZ2V0TW9kZWxDbGFzcygpLCBbXSwgYmFzZVRhYmxlTmFtZSlcbiAgICBzcWwgKz0gXCIpXCJcblxuICAgIHJldHVybiBzcWxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlc29sdmUgY29sdW1uIG5hbWUuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgLSBBdHRyaWJ1dGUgb3IgY29sdW1uIG5hbWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmcgfCB1bmRlZmluZWR9IC0gVGhlIHJlc29sdmVkIGNvbHVtbiBuYW1lLlxuICAgKi9cbiAgX3Jlc29sdmVDb2x1bW5OYW1lKG1vZGVsQ2xhc3MsIGtleSkge1xuICAgIGNvbnN0IGF0dHJpYnV0ZU1hcCA9IG1vZGVsQ2xhc3MuZ2V0QXR0cmlidXRlTmFtZVRvQ29sdW1uTmFtZU1hcCgpXG5cbiAgICBpZiAoYXR0cmlidXRlTWFwW2tleV0pIHJldHVybiBhdHRyaWJ1dGVNYXBba2V5XVxuXG4gICAgY29uc3QgY29sdW1uTWFwID0gbW9kZWxDbGFzcy5nZXRDb2x1bW5OYW1lVG9BdHRyaWJ1dGVOYW1lTWFwKClcbiAgICBjb25zdCB1bmRlcnNjb3JlZCA9IGluZmxlY3Rpb24udW5kZXJzY29yZShrZXkpXG5cbiAgICBpZiAoY29sdW1uTWFwW2tleV0pIHJldHVybiBrZXlcbiAgICBpZiAoY29sdW1uTWFwW3VuZGVyc2NvcmVkXSkgcmV0dXJuIHVuZGVyc2NvcmVkXG5cbiAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgcmVsYXRpb25zaGlwLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gcmVsYXRpb25zaGlwTmFtZSAtIFJlbGF0aW9uc2hpcCBuYW1lLlxuICAgKiBAcmV0dXJucyB7aW1wb3J0KFwiLi4vcmVjb3JkL3JlbGF0aW9uc2hpcHMvYmFzZS5qc1wiKS5kZWZhdWx0IHwgdW5kZWZpbmVkfSAtIFRoZSByZWxhdGlvbnNoaXAuXG4gICAqL1xuICBfZ2V0UmVsYXRpb25zaGlwKG1vZGVsQ2xhc3MsIHJlbGF0aW9uc2hpcE5hbWUpIHtcbiAgICByZXR1cm4gbW9kZWxDbGFzcy5nZXRSZWxhdGlvbnNoaXBzTWFwKClbcmVsYXRpb25zaGlwTmFtZV1cbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIHJlbGF0aW9uc2hpcCB3aGVyZSBvcGVyYXRvciB0dXBsZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdHVwbGVWYWx1ZSAtIENhbmRpZGF0ZSB0dXBsZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGlzIGlzIGEgcmVsYXRpb25zaGlwIHdoZXJlIHR1cGxlLlxuICAgKi9cbiAgX2lzUmVsYXRpb25zaGlwV2hlcmVPcGVyYXRvclR1cGxlKHR1cGxlVmFsdWUpIHtcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkodHVwbGVWYWx1ZSkgfHwgdHVwbGVWYWx1ZS5sZW5ndGggPCAzKSB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG5cbiAgICByZXR1cm4gdHlwZW9mIHR1cGxlVmFsdWVbMF0gPT09IFwic3RyaW5nXCIgJiZcbiAgICAgIHR5cGVvZiB0dXBsZVZhbHVlWzFdID09PSBcInN0cmluZ1wiICYmXG4gICAgICByZWxhdGlvbnNoaXBXaGVyZU9wZXJhdG9ycy5oYXModHVwbGVWYWx1ZVsxXSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSByZWxhdGlvbnNoaXAgd2hlcmUgb3BlcmF0b3IgdHVwbGVzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENhbmRpZGF0ZSByZWxhdGlvbnNoaXAgd2hlcmUgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtBcnJheTxbc3RyaW5nLCBcImVxXCIgfCBcIm5vdEVxXCIgfCBcImd0XCIgfCBcImd0ZXFcIiB8IFwibHRcIiB8IFwibHRlcVwiIHwgXCJsaWtlXCIsIHVua25vd25dPn0gLSBOb3JtYWxpemVkIHR1cGxlcy5cbiAgICovXG4gIF9ub3JtYWxpemVSZWxhdGlvbnNoaXBXaGVyZU9wZXJhdG9yVHVwbGVzKHZhbHVlKSB7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHJlbGF0aW9uc2hpcCB3aGVyZSB0dXBsZSBjb250YWluZXIgdHlwZTogJHt0eXBlb2YgdmFsdWV9YClcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBOb3JtYWxpemVkLlxuICAgICAqIEB0eXBlIHtBcnJheTxbc3RyaW5nLCBcImVxXCIgfCBcIm5vdEVxXCIgfCBcImd0XCIgfCBcImd0ZXFcIiB8IFwibHRcIiB8IFwibHRlcVwiIHwgXCJsaWtlXCIsIHVua25vd25dPn0gKi9cbiAgICBjb25zdCBub3JtYWxpemVkID0gW11cbiAgICAvKipcbiAgICAgKiBBZGQgY29uZGl0aW9uLlxuICAgICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGNvbmRpdGlvblZhbHVlIC0gQ2FuZGlkYXRlIG5lc3RlZCBjb25kaXRpb24uXG4gICAgICovXG4gICAgY29uc3QgYWRkQ29uZGl0aW9uID0gKGNvbmRpdGlvblZhbHVlKSA9PiB7XG4gICAgICBpZiAodGhpcy5faXNSZWxhdGlvbnNoaXBXaGVyZU9wZXJhdG9yVHVwbGUoY29uZGl0aW9uVmFsdWUpKSB7XG4gICAgICAgIGNvbnN0IHR1cGxlID0gLyoqIEB0eXBlIHtbc3RyaW5nLCBcImVxXCIgfCBcIm5vdEVxXCIgfCBcImd0XCIgfCBcImd0ZXFcIiB8IFwibHRcIiB8IFwibHRlcVwiIHwgXCJsaWtlXCIgfCBcIj5cIiB8IFwiPj1cIiB8IFwiPFwiIHwgXCI8PVwiLCB1bmtub3duLCAuLi5BcnJheTx1bmtub3duPl19ICovIChjb25kaXRpb25WYWx1ZSlcbiAgICAgICAgY29uc3Qgbm9ybWFsaXplZE9wZXJhdG9yID0gbm9ybWFsaXplUmVsYXRpb25zaGlwV2hlcmVPcGVyYXRvcih0dXBsZVsxXSlcblxuICAgICAgICBub3JtYWxpemVkLnB1c2goW1xuICAgICAgICAgIHR1cGxlWzBdLFxuICAgICAgICAgIG5vcm1hbGl6ZWRPcGVyYXRvcixcbiAgICAgICAgICB0dXBsZVsyXVxuICAgICAgICBdKVxuXG4gICAgICAgIGlmICh0dXBsZS5sZW5ndGggPiAzKSB7XG4gICAgICAgICAgZm9yIChsZXQgaW5kZXggPSAzOyBpbmRleCA8IHR1cGxlLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgICAgICAgICAgYWRkQ29uZGl0aW9uKHR1cGxlW2luZGV4XSlcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgaWYgKCFBcnJheS5pc0FycmF5KGNvbmRpdGlvblZhbHVlKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZWxhdGlvbnNoaXAgd2hlcmUgY29uZGl0aW9ucyBtdXN0IGJlIHR1cGxlc1wiKVxuICAgICAgfVxuXG4gICAgICBjb25kaXRpb25WYWx1ZS5mb3JFYWNoKChuZXN0ZWRDb25kaXRpb25WYWx1ZSkgPT4ge1xuICAgICAgICBhZGRDb25kaXRpb24obmVzdGVkQ29uZGl0aW9uVmFsdWUpXG4gICAgICB9KVxuICAgIH1cblxuICAgIGFkZENvbmRpdGlvbih2YWx1ZSlcblxuICAgIGlmIChub3JtYWxpemVkLmxlbmd0aCA8IDEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlJlbGF0aW9uc2hpcCB3aGVyZSB0dXBsZSBjb250YWluZXIgY2Fubm90IGJlIGVtcHR5XCIpXG4gICAgfVxuXG4gICAgcmV0dXJuIG5vcm1hbGl6ZWRcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGlzIHJlbGF0aW9uc2hpcCB3aGVyZSBvcGVyYXRvciB0dXBsZSBjb250YWluZXIuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHZhbHVlIC0gQ2FuZGlkYXRlIHJlbGF0aW9uc2hpcCB3aGVyZSB2YWx1ZS5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB2YWx1ZSBjYW4gYmUgbm9ybWFsaXplZCB0byByZWxhdGlvbnNoaXAgdHVwbGVzLlxuICAgKi9cbiAgX2lzUmVsYXRpb25zaGlwV2hlcmVPcGVyYXRvclR1cGxlQ29udGFpbmVyKHZhbHVlKSB7XG4gICAgdHJ5IHtcbiAgICAgIHRoaXMuX25vcm1hbGl6ZVJlbGF0aW9uc2hpcFdoZXJlT3BlcmF0b3JUdXBsZXModmFsdWUpXG5cbiAgICAgIHJldHVybiB0cnVlXG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyB3aGVyZSBzcWxmcm9tIHJlbGF0aW9uc2hpcCB3aGVyZSBvcGVyYXRvciB0dXBsZXMuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gUmVsYXRpb25zaGlwIHdoZXJlIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsQ2xhc3MgLSBSZWxhdGlvbnNoaXAgbW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnRhYmxlTmFtZSAtIFJlbGF0aW9uc2hpcCB0YWJsZSByZWZlcmVuY2UgbmFtZS5cbiAgICogQHBhcmFtIHtBcnJheTxbc3RyaW5nLCBcImVxXCIgfCBcIm5vdEVxXCIgfCBcImd0XCIgfCBcImd0ZXFcIiB8IFwibHRcIiB8IFwibHRlcVwiIHwgXCJsaWtlXCIsIHVua25vd25dPn0gYXJncy50dXBsZXMgLSBPcGVyYXRvciB0dXBsZXMuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIHdoZXJlIGZyYWdtZW50LlxuICAgKi9cbiAgX3doZXJlU1FMRnJvbVJlbGF0aW9uc2hpcFdoZXJlT3BlcmF0b3JUdXBsZXMoe21vZGVsQ2xhc3MsIHRhYmxlTmFtZSwgdHVwbGVzfSkge1xuICAgIGNvbnN0IG9wdGlvbnMgPSB0aGlzLmdldE9wdGlvbnMoKVxuICAgIGxldCBzcWwgPSBcIlwiXG4gICAgbGV0IGluZGV4ID0gMFxuXG4gICAgdHVwbGVzLmZvckVhY2goKFthdHRyaWJ1dGVOYW1lLCBvcGVyYXRvciwgd2hlcmVWYWx1ZV0pID0+IHtcbiAgICAgIGlmIChpbmRleCA+IDApIHNxbCArPSBcIiBBTkQgXCJcblxuICAgICAgY29uc3QgY29sdW1uTmFtZSA9IHRoaXMuX3Jlc29sdmVDb2x1bW5OYW1lKG1vZGVsQ2xhc3MsIGF0dHJpYnV0ZU5hbWUpXG5cbiAgICAgIGlmICghY29sdW1uTmFtZSkgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIGF0dHJpYnV0ZSBcIiR7YXR0cmlidXRlTmFtZX1cIiBmb3IgJHttb2RlbENsYXNzLm5hbWV9YClcblxuICAgICAgY29uc3Qgbm9ybWFsaXplZFZhbHVlID0gdGhpcy5fbm9ybWFsaXplU3FsaXRlQm9vbGVhblZhbHVlKHtcbiAgICAgICAgY29sdW1uTmFtZSxcbiAgICAgICAgbW9kZWxDbGFzcyxcbiAgICAgICAgdmFsdWU6IHdoZXJlVmFsdWVcbiAgICAgIH0pXG4gICAgICBjb25zdCB0eXBlZFZhbHVlID0gdGhpcy5fbm9ybWFsaXplVmFsdWVGb3JDb2x1bW5UeXBlKHtcbiAgICAgICAgY29sdW1uTmFtZSxcbiAgICAgICAgbW9kZWxDbGFzcyxcbiAgICAgICAgdmFsdWU6IG5vcm1hbGl6ZWRWYWx1ZVxuICAgICAgfSlcbiAgICAgIGNvbnN0IGNvbHVtblR5cGUgPSBtb2RlbENsYXNzLmdldENvbHVtblR5cGVCeU5hbWUoY29sdW1uTmFtZSlcbiAgICAgIGNvbnN0IGRyaXZlclR5cGUgPSB0aGlzLmdldFF1ZXJ5KCkuZHJpdmVyLmdldFR5cGUoKVxuXG4gICAgICBpZiAodHlwZWRWYWx1ZSA9PT0gTk9fTUFUQ0gpIHtcbiAgICAgICAgaWYgKG9wZXJhdG9yID09PSBcIm5vdEVxXCIpIHtcbiAgICAgICAgICBzcWwgKz0gXCIxPTFcIlxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHNxbCArPSBcIjE9MFwiXG4gICAgICAgIH1cbiAgICAgICAgaW5kZXggKz0gMVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgbGV0IGNvbHVtblNxbCA9IGAke29wdGlvbnMucXVvdGVUYWJsZU5hbWUodGFibGVOYW1lKX0uJHtvcHRpb25zLnF1b3RlQ29sdW1uTmFtZShjb2x1bW5OYW1lKX1gXG5cbiAgICAgIGlmIChkcml2ZXJUeXBlID09IFwibXNzcWxcIiAmJiB0eXBlb2Ygd2hlcmVWYWx1ZSA9PT0gXCJzdHJpbmdcIiAmJiBjb2x1bW5UeXBlPy50b0xvd2VyQ2FzZSgpID09IFwidGV4dFwiKSB7XG4gICAgICAgIGNvbHVtblNxbCA9IGBDQVNUKCR7Y29sdW1uU3FsfSBBUyBOVkFSQ0hBUihNQVgpKWBcbiAgICAgIH1cblxuICAgICAgaWYgKG9wZXJhdG9yID09PSBcImVxXCIpIHtcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkodHlwZWRWYWx1ZSkpIHtcbiAgICAgICAgICBpZiAodHlwZWRWYWx1ZS5sZW5ndGggPCAxKSB7XG4gICAgICAgICAgICBzcWwgKz0gXCIxPTBcIlxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBzcWwgKz0gYCR7Y29sdW1uU3FsfSBJTiAoJHt0eXBlZFZhbHVlLm1hcCgodmFsdWUpID0+IG9wdGlvbnMucXVvdGUodmFsdWUpKS5qb2luKFwiLCBcIil9KWBcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAodHlwZWRWYWx1ZSA9PT0gbnVsbCkge1xuICAgICAgICAgIHNxbCArPSBgJHtjb2x1bW5TcWx9IElTIE5VTExgXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgc3FsICs9IGAke2NvbHVtblNxbH0gPSAke29wdGlvbnMucXVvdGUodHlwZWRWYWx1ZSl9YFxuICAgICAgICB9XG5cbiAgICAgICAgaW5kZXggKz0gMVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgaWYgKG9wZXJhdG9yID09PSBcIm5vdEVxXCIpIHtcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkodHlwZWRWYWx1ZSkpIHtcbiAgICAgICAgICBpZiAodHlwZWRWYWx1ZS5sZW5ndGggPCAxKSB7XG4gICAgICAgICAgICBzcWwgKz0gXCIxPTFcIlxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBzcWwgKz0gYCR7Y29sdW1uU3FsfSBOT1QgSU4gKCR7dHlwZWRWYWx1ZS5tYXAoKHZhbHVlKSA9PiBvcHRpb25zLnF1b3RlKHZhbHVlKSkuam9pbihcIiwgXCIpfSlgXG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKHR5cGVkVmFsdWUgPT09IG51bGwpIHtcbiAgICAgICAgICBzcWwgKz0gYCR7Y29sdW1uU3FsfSBJUyBOT1QgTlVMTGBcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBzcWwgKz0gYCR7Y29sdW1uU3FsfSAhPSAke29wdGlvbnMucXVvdGUodHlwZWRWYWx1ZSl9YFxuICAgICAgICB9XG5cbiAgICAgICAgaW5kZXggKz0gMVxuICAgICAgICByZXR1cm5cbiAgICAgIH1cblxuICAgICAgaWYgKEFycmF5LmlzQXJyYXkodHlwZWRWYWx1ZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBPcGVyYXRvciBcIiR7b3BlcmF0b3J9XCIgZG9lcyBub3Qgc3VwcG9ydCBhcnJheSB2YWx1ZXMgZm9yICR7bW9kZWxDbGFzcy5uYW1lfS4ke2F0dHJpYnV0ZU5hbWV9YClcbiAgICAgIH1cblxuICAgICAgaWYgKHR5cGVkVmFsdWUgPT09IG51bGwpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBPcGVyYXRvciBcIiR7b3BlcmF0b3J9XCIgZG9lcyBub3Qgc3VwcG9ydCBudWxsIHZhbHVlcyBmb3IgJHttb2RlbENsYXNzLm5hbWV9LiR7YXR0cmlidXRlTmFtZX1gKVxuICAgICAgfVxuXG4gICAgICBjb25zdCBvcGVyYXRvck1hcCA9IHtcbiAgICAgICAgZ3Q6IFwiPlwiLFxuICAgICAgICBndGVxOiBcIj49XCIsXG4gICAgICAgIGxpa2U6IFwiTElLRVwiLFxuICAgICAgICBsdDogXCI8XCIsXG4gICAgICAgIGx0ZXE6IFwiPD1cIlxuICAgICAgfVxuXG4gICAgICBzcWwgKz0gYCR7Y29sdW1uU3FsfSAke29wZXJhdG9yTWFwW29wZXJhdG9yXX0gJHtvcHRpb25zLnF1b3RlKHR5cGVkVmFsdWUpfWBcbiAgICAgIGluZGV4ICs9IDFcbiAgICB9KVxuXG4gICAgcmV0dXJuIHNxbFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIHNxbGl0ZSBib29sZWFuIHZhbHVlLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNvbHVtbk5hbWUgLSBDb2x1bW4gbmFtZS5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gYXJncy52YWx1ZSAtIFZhbHVlIHRvIG5vcm1hbGl6ZS5cbiAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIE5vcm1hbGl6ZWQgdmFsdWUuXG4gICAqL1xuICBfbm9ybWFsaXplU3FsaXRlQm9vbGVhblZhbHVlKHttb2RlbENsYXNzLCBjb2x1bW5OYW1lLCB2YWx1ZX0pIHtcbiAgICBpZiAobW9kZWxDbGFzcy5nZXREYXRhYmFzZVR5cGUoKSAhPSBcInNxbGl0ZVwiKSByZXR1cm4gdmFsdWVcblxuICAgIGNvbnN0IGNvbHVtblR5cGUgPSBtb2RlbENsYXNzLmdldENvbHVtblR5cGVCeU5hbWUoY29sdW1uTmFtZSlcblxuICAgIGlmICghY29sdW1uVHlwZSkgcmV0dXJuIHZhbHVlXG4gICAgaWYgKGNvbHVtblR5cGUudG9Mb3dlckNhc2UoKSAhPT0gXCJib29sZWFuXCIpIHJldHVybiB2YWx1ZVxuXG4gICAgLyoqXG4gICAgICogTm9ybWFsaXplLlxuICAgICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGVudHJ5IC0gVmFsdWUgdG8gbm9ybWFsaXplLlxuICAgICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBTUUxpdGUgcHJlZGljYXRlIHZhbHVlIHdpdGggYm9vbGVhbnMgZW5jb2RlZCBhcyAxIG9yIDAuXG4gICAgICovXG4gICAgY29uc3Qgbm9ybWFsaXplID0gKGVudHJ5KSA9PiB7XG4gICAgICBpZiAoZW50cnkgPT09IHRydWUpIHJldHVybiAxXG4gICAgICBpZiAoZW50cnkgPT09IGZhbHNlKSByZXR1cm4gMFxuICAgICAgcmV0dXJuIGVudHJ5XG4gICAgfVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICByZXR1cm4gdmFsdWUubWFwKChlbnRyeSkgPT4gbm9ybWFsaXplKGVudHJ5KSlcbiAgICB9XG5cbiAgICByZXR1cm4gbm9ybWFsaXplKHZhbHVlKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbm9ybWFsaXplIHZhbHVlIGZvciBjb2x1bW4gdHlwZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jb2x1bW5OYW1lIC0gQ29sdW1uIG5hbWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MudmFsdWUgLSBWYWx1ZSB0byBub3JtYWxpemUuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBOb3JtYWxpemVkIHZhbHVlLlxuICAgKi9cbiAgX25vcm1hbGl6ZVZhbHVlRm9yQ29sdW1uVHlwZSh7bW9kZWxDbGFzcywgY29sdW1uTmFtZSwgdmFsdWV9KSB7XG4gICAgY29uc3QgY29sdW1uVHlwZSA9IG1vZGVsQ2xhc3MuZ2V0Q29sdW1uVHlwZUJ5TmFtZShjb2x1bW5OYW1lKVxuXG4gICAgaWYgKCFjb2x1bW5UeXBlKSByZXR1cm4gdmFsdWVcblxuICAgIGNvbnN0IG5vcm1hbGl6ZWRUeXBlID0gY29sdW1uVHlwZS50b0xvd2VyQ2FzZSgpXG4gICAgY29uc3Qgc3RyaW5nVHlwZXMgPSBuZXcgU2V0KFtcImNoYXJcIiwgXCJ2YXJjaGFyXCIsIFwibnZhcmNoYXJcIiwgXCJzdHJpbmdcIiwgXCJlbnVtXCIsIFwianNvblwiLCBcImpzb25iXCIsIFwiY2l0ZXh0XCIsIFwiYmluYXJ5XCIsIFwidmFyYmluYXJ5XCJdKVxuICAgIGNvbnN0IGlzVXVpZFR5cGUgPSBub3JtYWxpemVkVHlwZS5pbmNsdWRlcyhcInV1aWRcIilcbiAgICBjb25zdCBzaG91bGRDb2VyY2VUb1N0cmluZyA9IG5vcm1hbGl6ZWRUeXBlLmluY2x1ZGVzKFwidXVpZFwiKSB8fFxuICAgICAgbm9ybWFsaXplZFR5cGUuaW5jbHVkZXMoXCJ0ZXh0XCIpIHx8XG4gICAgICBzdHJpbmdUeXBlcy5oYXMobm9ybWFsaXplZFR5cGUpXG5cbiAgICAvKipcbiAgICAgKiBOb3JtYWxpemUuXG4gICAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZW50cnkgLSBWYWx1ZSB0byBub3JtYWxpemUuXG4gICAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIENvbHVtbi1jb21wYXRpYmxlIHByZWRpY2F0ZSB2YWx1ZSwgb3IgdGhlIG5vLW1hdGNoIHNlbnRpbmVsIGZvciBudW1lcmljIFVVSURzLlxuICAgICAqL1xuICAgIGNvbnN0IG5vcm1hbGl6ZSA9IChlbnRyeSkgPT4ge1xuICAgICAgaWYgKGlzVXVpZFR5cGUgJiYgdHlwZW9mIGVudHJ5ID09PSBcIm51bWJlclwiKSByZXR1cm4gTk9fTUFUQ0hcbiAgICAgIGlmICghc2hvdWxkQ29lcmNlVG9TdHJpbmcgfHwgdHlwZW9mIGVudHJ5ICE9PSBcIm51bWJlclwiKSByZXR1cm4gZW50cnlcblxuICAgICAgcmV0dXJuIFN0cmluZyhlbnRyeSlcbiAgICB9XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSB2YWx1ZS5tYXAoKGVudHJ5KSA9PiBub3JtYWxpemUoZW50cnkpKS5maWx0ZXIoKGVudHJ5KSA9PiBlbnRyeSAhPT0gTk9fTUFUQ0gpXG5cbiAgICAgIGlmIChpc1V1aWRUeXBlICYmIG5vcm1hbGl6ZWQubGVuZ3RoID09PSAwKSByZXR1cm4gTk9fTUFUQ0hcblxuICAgICAgcmV0dXJuIG5vcm1hbGl6ZWRcbiAgICB9XG5cbiAgICBjb25zdCBub3JtYWxpemVkID0gbm9ybWFsaXplKHZhbHVlKVxuXG4gICAgaWYgKG5vcm1hbGl6ZWQgPT09IE5PX01BVENIKSByZXR1cm4gTk9fTUFUQ0hcblxuICAgIHJldHVybiBub3JtYWxpemVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3aGVyZSBzcWxmcm9tIGhhc2guXG4gICAqIEBwYXJhbSB7V2hlcmVIYXNofSBoYXNoIC0gSGFzaC5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtzdHJpbmdbXX0gcGF0aCAtIEpvaW4gcGF0aC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFt0YWJsZU5hbWVdIC0gVGFibGUgbmFtZS5cbiAgICogQHBhcmFtIHtudW1iZXJ9IGluZGV4IC0gSW5kZXggdmFsdWUuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gU1FMIHN0cmluZy5cbiAgICovXG4gIF93aGVyZVNRTEZyb21IYXNoKGhhc2gsIG1vZGVsQ2xhc3MsIHBhdGgsIHRhYmxlTmFtZSwgaW5kZXggPSAwKSB7XG4gICAgY29uc3Qgb3B0aW9ucyA9IHRoaXMuZ2V0T3B0aW9ucygpXG4gICAgY29uc3QgbW9kZWxRdWVyeSA9IC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9tb2RlbC1jbGFzcy1xdWVyeS5qc1wiKS5kZWZhdWx0fSAqLyAodGhpcy5xdWVyeSlcbiAgICBsZXQgc3FsID0gXCJcIlxuXG4gICAgZm9yIChjb25zdCB3aGVyZUtleSBpbiBoYXNoKSB7XG4gICAgICBjb25zdCB3aGVyZVZhbHVlID0gaGFzaFt3aGVyZUtleV1cbiAgICAgIGNvbnN0IHJlbGF0aW9uc2hpcCA9IHRoaXMuX2dldFJlbGF0aW9uc2hpcChtb2RlbENsYXNzLCB3aGVyZUtleSlcbiAgICAgIGNvbnN0IHR1cGxlcyA9IHRoaXMuX2lzUmVsYXRpb25zaGlwV2hlcmVPcGVyYXRvclR1cGxlQ29udGFpbmVyKHdoZXJlVmFsdWUpXG4gICAgICAgID8gdGhpcy5fbm9ybWFsaXplUmVsYXRpb25zaGlwV2hlcmVPcGVyYXRvclR1cGxlcyh3aGVyZVZhbHVlKVxuICAgICAgICA6IG51bGxcbiAgICAgIGNvbnN0IHJlc29sdmVkQ29sdW1uTmFtZSA9IHRoaXMuX3Jlc29sdmVDb2x1bW5OYW1lKG1vZGVsQ2xhc3MsIHdoZXJlS2V5KVxuXG4gICAgICBpZiAocmVsYXRpb25zaGlwICYmIHR1cGxlcykge1xuICAgICAgICBpZiAoaW5kZXggPiAwKSBzcWwgKz0gXCIgQU5EIFwiXG5cbiAgICAgICAgY29uc3QgcmF3VGFyZ2V0TW9kZWxDbGFzcyA9IHJlbGF0aW9uc2hpcC5nZXRUYXJnZXRNb2RlbENsYXNzKClcblxuICAgICAgICBpZiAoIXJhd1RhcmdldE1vZGVsQ2xhc3MpIHRocm93IG5ldyBFcnJvcihgUmVsYXRpb25zaGlwIFwiJHt3aGVyZUtleX1cIiBmb3IgJHttb2RlbENsYXNzLm5hbWV9IGhhcyBubyB0YXJnZXQgbW9kZWwgY2xhc3NgKVxuXG4gICAgICAgIGNvbnN0IHRhcmdldE1vZGVsQ2xhc3MgPSBtb2RlbENsYXNzLmJpbmRSZWNvcmRNZXRhZGF0YU1vZGVsQ2xhc3MocmF3VGFyZ2V0TW9kZWxDbGFzcylcblxuICAgICAgICBjb25zdCBuZXN0ZWRQYXRoID0gcGF0aC5jb25jYXQoW3doZXJlS2V5XSlcbiAgICAgICAgY29uc3QgbmVzdGVkVGFibGVOYW1lID0gbW9kZWxRdWVyeS5nZXRUYWJsZVJlZmVyZW5jZUZvckpvaW4oLi4ubmVzdGVkUGF0aClcblxuICAgICAgICBzcWwgKz0gdGhpcy5fd2hlcmVTUUxGcm9tUmVsYXRpb25zaGlwV2hlcmVPcGVyYXRvclR1cGxlcyh7XG4gICAgICAgICAgbW9kZWxDbGFzczogdGFyZ2V0TW9kZWxDbGFzcyxcbiAgICAgICAgICB0YWJsZU5hbWU6IG5lc3RlZFRhYmxlTmFtZSxcbiAgICAgICAgICB0dXBsZXNcbiAgICAgICAgfSlcbiAgICAgIH0gZWxzZSBpZiAocmVzb2x2ZWRDb2x1bW5OYW1lICYmIHR1cGxlcykge1xuICAgICAgICBpZiAoaW5kZXggPiAwKSBzcWwgKz0gXCIgQU5EIFwiXG5cbiAgICAgICAgc3FsICs9IHRoaXMuX3doZXJlU1FMRnJvbVJlbGF0aW9uc2hpcFdoZXJlT3BlcmF0b3JUdXBsZXMoe1xuICAgICAgICAgIG1vZGVsQ2xhc3MsXG4gICAgICAgICAgdGFibGVOYW1lOiB0YWJsZU5hbWUgfHwgbW9kZWxRdWVyeS5nZXRUYWJsZVJlZmVyZW5jZUZvckpvaW4oLi4ucGF0aCksXG4gICAgICAgICAgdHVwbGVzXG4gICAgICAgIH0pXG4gICAgICB9IGVsc2UgaWYgKEFycmF5LmlzQXJyYXkod2hlcmVWYWx1ZSkgJiYgd2hlcmVWYWx1ZS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgaWYgKGluZGV4ID4gMCkgc3FsICs9IFwiIEFORCBcIlxuICAgICAgICBzcWwgKz0gXCIxPTBcIlxuICAgICAgfSBlbHNlIGlmIChpc1BsYWluT2JqZWN0KHdoZXJlVmFsdWUpKSB7XG4gICAgICAgIGlmICghcmVsYXRpb25zaGlwKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIHJlbGF0aW9uc2hpcCBcIiR7d2hlcmVLZXl9XCIgZm9yICR7bW9kZWxDbGFzcy5uYW1lfWApXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCByYXdUYXJnZXRNb2RlbENsYXNzID0gcmVsYXRpb25zaGlwLmdldFRhcmdldE1vZGVsQ2xhc3MoKVxuXG4gICAgICAgIGlmICghcmF3VGFyZ2V0TW9kZWxDbGFzcykgdGhyb3cgbmV3IEVycm9yKGBSZWxhdGlvbnNoaXAgXCIke3doZXJlS2V5fVwiIGZvciAke21vZGVsQ2xhc3MubmFtZX0gaGFzIG5vIHRhcmdldCBtb2RlbCBjbGFzc2ApXG5cbiAgICAgICAgY29uc3QgdGFyZ2V0TW9kZWxDbGFzcyA9IG1vZGVsQ2xhc3MuYmluZFJlY29yZE1ldGFkYXRhTW9kZWxDbGFzcyhyYXdUYXJnZXRNb2RlbENsYXNzKVxuXG4gICAgICAgIGNvbnN0IG5lc3RlZEhhc2ggPSAvKiogQHR5cGUge1doZXJlSGFzaH0gKi8gKHdoZXJlVmFsdWUpXG4gICAgICAgIGNvbnN0IG5lc3RlZFBhdGggPSBwYXRoLmNvbmNhdChbd2hlcmVLZXldKVxuICAgICAgICBjb25zdCBuZXN0ZWRUYWJsZU5hbWUgPSBtb2RlbFF1ZXJ5LmdldFRhYmxlUmVmZXJlbmNlRm9ySm9pbiguLi5uZXN0ZWRQYXRoKVxuXG4gICAgICAgIHNxbCArPSB0aGlzLl93aGVyZVNRTEZyb21IYXNoKG5lc3RlZEhhc2gsIHRhcmdldE1vZGVsQ2xhc3MsIG5lc3RlZFBhdGgsIG5lc3RlZFRhYmxlTmFtZSwgaW5kZXgpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAoaW5kZXggPiAwKSBzcWwgKz0gXCIgQU5EIFwiXG5cbiAgICAgICAgY29uc3QgY29sdW1uTmFtZSA9IHRoaXMuX3Jlc29sdmVDb2x1bW5OYW1lKG1vZGVsQ2xhc3MsIHdoZXJlS2V5KVxuXG4gICAgICAgIGlmICghY29sdW1uTmFtZSkgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIGF0dHJpYnV0ZSBcIiR7d2hlcmVLZXl9XCIgZm9yICR7bW9kZWxDbGFzcy5uYW1lfWApXG5cbiAgICAgICAgY29uc3QgY29sdW1uVHlwZSA9IG1vZGVsQ2xhc3MuZ2V0Q29sdW1uVHlwZUJ5TmFtZShjb2x1bW5OYW1lKVxuXG4gICAgICAgIGNvbnN0IG5vcm1hbGl6ZWRWYWx1ZSA9IHRoaXMuX25vcm1hbGl6ZVNxbGl0ZUJvb2xlYW5WYWx1ZSh7XG4gICAgICAgICAgY29sdW1uTmFtZSxcbiAgICAgICAgICBtb2RlbENsYXNzLFxuICAgICAgICAgIHZhbHVlOiB3aGVyZVZhbHVlXG4gICAgICAgIH0pXG4gICAgICAgIGNvbnN0IHR5cGVkVmFsdWUgPSB0aGlzLl9ub3JtYWxpemVWYWx1ZUZvckNvbHVtblR5cGUoe1xuICAgICAgICAgIGNvbHVtbk5hbWUsXG4gICAgICAgICAgbW9kZWxDbGFzcyxcbiAgICAgICAgICB2YWx1ZTogbm9ybWFsaXplZFZhbHVlXG4gICAgICAgIH0pXG5cbiAgICAgICAgaWYgKHR5cGVkVmFsdWUgPT09IE5PX01BVENIKSB7XG4gICAgICAgICAgc3FsICs9IFwiMT0wXCJcbiAgICAgICAgICBpbmRleCsrXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuXG4gICAgICAgIGxldCBjb2x1bW5TcWwgPSBgJHtvcHRpb25zLnF1b3RlQ29sdW1uTmFtZShjb2x1bW5OYW1lKX1gXG5cbiAgICAgICAgaWYgKHRhYmxlTmFtZSkge1xuICAgICAgICAgIGNvbHVtblNxbCA9IGAke29wdGlvbnMucXVvdGVUYWJsZU5hbWUodGFibGVOYW1lKX0uJHtjb2x1bW5TcWx9YFxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgZHJpdmVyVHlwZSA9IHRoaXMuZ2V0UXVlcnkoKS5kcml2ZXIuZ2V0VHlwZSgpXG5cbiAgICAgICAgaWYgKGRyaXZlclR5cGUgPT0gXCJtc3NxbFwiICYmIHR5cGVvZiB3aGVyZVZhbHVlID09PSBcInN0cmluZ1wiICYmIGNvbHVtblR5cGU/LnRvTG93ZXJDYXNlKCkgPT0gXCJ0ZXh0XCIpIHtcbiAgICAgICAgICBjb2x1bW5TcWwgPSBgQ0FTVCgke2NvbHVtblNxbH0gQVMgTlZBUkNIQVIoTUFYKSlgXG4gICAgICAgIH1cblxuICAgICAgICBzcWwgKz0gY29sdW1uU3FsXG5cbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkodHlwZWRWYWx1ZSkpIHtcbiAgICAgICAgICBzcWwgKz0gYCBJTiAoJHt0eXBlZFZhbHVlLm1hcCgodmFsdWUpID0+IG9wdGlvbnMucXVvdGUodmFsdWUpKS5qb2luKFwiLCBcIil9KWBcbiAgICAgICAgfSBlbHNlIGlmICh0eXBlZFZhbHVlID09PSBudWxsKSB7XG4gICAgICAgICAgc3FsICs9IFwiIElTIE5VTExcIlxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHNxbCArPSBgID0gJHtvcHRpb25zLnF1b3RlKHR5cGVkVmFsdWUpfWBcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpbmRleCsrXG4gICAgfVxuXG4gICAgcmV0dXJuIHNxbFxuICB9XG59XG4iXX0=