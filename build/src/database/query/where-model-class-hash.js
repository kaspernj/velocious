// @ts-check
import * as inflection from "inflection";
import { isPlainObject } from "is-plain-object";
import WhereBase from "./where-base.js";
import WhereIn from "./where-in.js";
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
        const stringTypes = new Set(["char", "varchar", "nvarchar", "string", "enum", "json", "jsonb", "citext", "binary", "varbinary", "character varying"]);
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
     * Normalizes explicit membership through the model's column metadata.
     * @param {{modelClass: typeof import("../record/index.js").default, columnName: string, tableName?: string, condition: unknown}} args - Resolved column and untrusted membership descriptor.
     * @returns {string} - Complete column membership predicate.
     */
    _whereSQLFromInCondition({ modelClass, columnName, tableName, condition }) {
        const options = this.getOptions();
        const values = WhereIn.values(condition);
        const normalizedValues = this._normalizeSqliteBooleanValue({ columnName, modelClass, value: values });
        /** @type {import("./where-in.js").InValue[] | typeof NO_MATCH} */
        const typedValues = this._normalizeValueForColumnType({ columnName, modelClass, value: normalizedValues });
        if (typedValues === NO_MATCH)
            return "1=0";
        const columnSql = tableName
            ? `${options.quoteTableName(tableName)}.${options.quoteColumnName(columnName)}`
            : options.quoteColumnName(columnName);
        const columnType = modelClass.getColumnTypeByName(columnName);
        const castText = this.getQuery().driver.getType() === "mssql" && columnType?.toLowerCase() === "text";
        return WhereIn.toSql({
            columnSql,
            inColumnSql: castText ? `CAST(${columnSql} AS NVARCHAR(MAX))` : columnSql,
            options,
            values: typedValues
        });
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
            if (resolvedColumnName && !relationship && isPlainObject(whereValue)) {
                if (index > 0)
                    sql += " AND ";
                sql += this._whereSQLFromInCondition({ columnName: resolvedColumnName, condition: whereValue, modelClass, tableName });
            }
            else if (relationship && tuples) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2hlcmUtbW9kZWwtY2xhc3MtaGFzaC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9kYXRhYmFzZS9xdWVyeS93aGVyZS1tb2RlbC1jbGFzcy1oYXNoLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEtBQUssVUFBVSxNQUFNLFlBQVksQ0FBQTtBQUN4QyxPQUFPLEVBQUMsYUFBYSxFQUFDLE1BQU0saUJBQWlCLENBQUE7QUFDN0MsT0FBTyxTQUFTLE1BQU0saUJBQWlCLENBQUE7QUFDdkMsT0FBTyxPQUFPLE1BQU0sZUFBZSxDQUFBO0FBRW5DOzs7R0FHRztBQUVILE1BQU0sUUFBUSxHQUFHLE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQTtBQUNuQyxNQUFNLDBCQUEwQixHQUFHLElBQUksR0FBRyxDQUFDLENBQUMsSUFBSSxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFLElBQUksRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLEdBQUcsRUFBRSxJQUFJLEVBQUUsR0FBRyxFQUFFLElBQUksQ0FBQyxDQUFDLENBQUE7QUFFckg7Ozs7R0FJRztBQUNILFNBQVMsa0NBQWtDLENBQUMsUUFBUTtJQUNsRCxNQUFNLGVBQWUsR0FBRztRQUN0QixHQUFHLEVBQUUsSUFBSTtRQUNULElBQUksRUFBRSxNQUFNO1FBQ1osR0FBRyxFQUFFLElBQUk7UUFDVCxJQUFJLEVBQUUsTUFBTTtLQUNiLENBQUE7SUFFRCxPQUFPLHNFQUFzRSxDQUFDLENBQzVFLGVBQWUsRUFBQyxzQ0FBdUMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxJQUFJLFFBQVEsQ0FDL0UsQ0FBQTtBQUNILENBQUM7QUFFRCxNQUFNLENBQUMsT0FBTyxPQUFPLHlDQUEwQyxTQUFRLFNBQVM7SUFDOUU7Ozs7Ozs7T0FPRztJQUNILFlBQVksRUFBQyxLQUFLLEVBQUUsSUFBSSxFQUFFLFVBQVUsRUFBRSxnQkFBZ0IsR0FBRyxLQUFL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RiIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgKiBhcyBpbmZsZWN0aW9uIGZyb20gXCJpbmZsZWN0aW9uXCJcbmltcG9ydCB7aXNQbGFpbk9iamVjdH0gZnJvbSBcImlzLXBsYWluLW9iamVjdFwiXG5pbXBvcnQgV2hlcmVCYXNlIGZyb20gXCIuL3doZXJlLWJhc2UuanNcIlxuaW1wb3J0IFdoZXJlSW4gZnJvbSBcIi4vd2hlcmUtaW4uanNcIlxuXG4vKipcbiAqIE5vIG1hdGNoLlxuICogQHR5cGVkZWYge3tba2V5OiBzdHJpbmddOiBzdHJpbmcgfCBudW1iZXIgfCBib29sZWFuIHwgbnVsbCB8IEFycmF5PHN0cmluZyB8IG51bWJlciB8IGJvb2xlYW4gfCBudWxsPiB8IFJlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn19IFdoZXJlSGFzaFxuICovXG5cbmNvbnN0IE5PX01BVENIID0gU3ltYm9sKFwibm8tbWF0Y2hcIilcbmNvbnN0IHJlbGF0aW9uc2hpcFdoZXJlT3BlcmF0b3JzID0gbmV3IFNldChbXCJlcVwiLCBcIm5vdEVxXCIsIFwiZ3RcIiwgXCJndGVxXCIsIFwibHRcIiwgXCJsdGVxXCIsIFwibGlrZVwiLCBcIj5cIiwgXCI+PVwiLCBcIjxcIiwgXCI8PVwiXSlcblxuLyoqXG4gKiBSdW5zIG5vcm1hbGl6ZSByZWxhdGlvbnNoaXAgd2hlcmUgb3BlcmF0b3IuXG4gKiBAcGFyYW0ge3N0cmluZ30gb3BlcmF0b3IgLSBSYXcgcmVsYXRpb25zaGlwIHdoZXJlIG9wZXJhdG9yLlxuICogQHJldHVybnMge1wiZXFcIiB8IFwibm90RXFcIiB8IFwiZ3RcIiB8IFwiZ3RlcVwiIHwgXCJsdFwiIHwgXCJsdGVxXCIgfCBcImxpa2VcIn0gLSBOb3JtYWxpemVkIG9wZXJhdG9yLlxuICovXG5mdW5jdGlvbiBub3JtYWxpemVSZWxhdGlvbnNoaXBXaGVyZU9wZXJhdG9yKG9wZXJhdG9yKSB7XG4gIGNvbnN0IG9wZXJhdG9yQWxpYXNlcyA9IHtcbiAgICBcIjxcIjogXCJsdFwiLFxuICAgIFwiPD1cIjogXCJsdGVxXCIsXG4gICAgXCI+XCI6IFwiZ3RcIixcbiAgICBcIj49XCI6IFwiZ3RlcVwiXG4gIH1cblxuICByZXR1cm4gLyoqIEB0eXBlIHtcImVxXCIgfCBcIm5vdEVxXCIgfCBcImd0XCIgfCBcImd0ZXFcIiB8IFwibHRcIiB8IFwibHRlcVwiIHwgXCJsaWtlXCJ9ICovIChcbiAgICBvcGVyYXRvckFsaWFzZXNbLyoqIEB0eXBlIHtcIjxcIiB8IFwiPD1cIiB8IFwiPlwiIHwgXCI+PVwifSAqLyAob3BlcmF0b3IpXSB8fCBvcGVyYXRvclxuICApXG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0RhdGFiYXNlUXVlcnlXaGVyZU1vZGVsQ2xhc3NIYXNoIGV4dGVuZHMgV2hlcmVCYXNlIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLnF1ZXJ5IC0gUXVlcnkgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7V2hlcmVIYXNofSBhcmdzLmhhc2ggLSBIYXNoLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MucXVhbGlmeUJhc2VUYWJsZV0gLSBXaGV0aGVyIHRvIHF1YWxpZnkgYmFzZSB0YWJsZSBjb2x1bW5zLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe3F1ZXJ5LCBoYXNoLCBtb2RlbENsYXNzLCBxdWFsaWZ5QmFzZVRhYmxlID0gZmFsc2V9KSB7XG4gICAgc3VwZXIoKVxuICAgIHRoaXMuaGFzaCA9IGhhc2hcbiAgICB0aGlzLm1vZGVsQ2xhc3MgPSBtb2RlbENsYXNzXG4gICAgdGhpcy5xdWFsaWZ5QmFzZVRhYmxlID0gcXVhbGlmeUJhc2VUYWJsZVxuICAgIHRoaXMucXVlcnkgPSBxdWVyeVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IG1vZGVsIGNsYXNzLlxuICAgKiBAcmV0dXJucyB7dHlwZW9mIGltcG9ydChcIi4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSAtIFRoZSBtb2RlbCBjbGFzcy5cbiAgICovXG4gIGdldE1vZGVsQ2xhc3MoKSB7XG4gICAgaWYgKCF0aGlzLm1vZGVsQ2xhc3MpIHRocm93IG5ldyBFcnJvcihcIm1vZGVsQ2xhc3Mgbm90IHNldFwiKVxuXG4gICAgcmV0dXJuIHRoaXMubW9kZWxDbGFzc1xuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgdG8gc3FsLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICB0b1NxbCgpIHtcbiAgICBsZXQgc3FsID0gXCIoXCJcblxuICAgIGNvbnN0IG1vZGVsUXVlcnkgPSAvKiogQHR5cGUge2ltcG9ydChcIi4vbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0gKi8gKHRoaXMucXVlcnkpXG4gICAgY29uc3QgYmFzZVRhYmxlTmFtZSA9IHRoaXMucXVhbGlmeUJhc2VUYWJsZVxuICAgICAgPyBtb2RlbFF1ZXJ5LmdldFRhYmxlUmVmZXJlbmNlRm9ySm9pbigpXG4gICAgICA6IHVuZGVmaW5lZFxuXG4gICAgc3FsICs9IHRoaXMuX3doZXJlU1FMRnJvbUhhc2godGhpcy5oYXNoLCB0aGlzLmdldE1vZGVsQ2xhc3MoKSwgW10sIGJhc2VUYWJsZU5hbWUpXG4gICAgc3FsICs9IFwiKVwiXG5cbiAgICByZXR1cm4gc3FsXG4gIH1cblxuICAvKipcbiAgICogUnVucyByZXNvbHZlIGNvbHVtbiBuYW1lLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gbW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30ga2V5IC0gQXR0cmlidXRlIG9yIGNvbHVtbiBuYW1lLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nIHwgdW5kZWZpbmVkfSAtIFRoZSByZXNvbHZlZCBjb2x1bW4gbmFtZS5cbiAgICovXG4gIF9yZXNvbHZlQ29sdW1uTmFtZShtb2RlbENsYXNzLCBrZXkpIHtcbiAgICBjb25zdCBhdHRyaWJ1dGVNYXAgPSBtb2RlbENsYXNzLmdldEF0dHJpYnV0ZU5hbWVUb0NvbHVtbk5hbWVNYXAoKVxuXG4gICAgaWYgKGF0dHJpYnV0ZU1hcFtrZXldKSByZXR1cm4gYXR0cmlidXRlTWFwW2tleV1cblxuICAgIGNvbnN0IGNvbHVtbk1hcCA9IG1vZGVsQ2xhc3MuZ2V0Q29sdW1uTmFtZVRvQXR0cmlidXRlTmFtZU1hcCgpXG4gICAgY29uc3QgdW5kZXJzY29yZWQgPSBpbmZsZWN0aW9uLnVuZGVyc2NvcmUoa2V5KVxuXG4gICAgaWYgKGNvbHVtbk1hcFtrZXldKSByZXR1cm4ga2V5XG4gICAgaWYgKGNvbHVtbk1hcFt1bmRlcnNjb3JlZF0pIHJldHVybiB1bmRlcnNjb3JlZFxuXG4gICAgcmV0dXJuIHVuZGVmaW5lZFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHJlbGF0aW9uc2hpcC5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IG1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHJlbGF0aW9uc2hpcE5hbWUgLSBSZWxhdGlvbnNoaXAgbmFtZS5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL3JlY29yZC9yZWxhdGlvbnNoaXBzL2Jhc2UuanNcIikuZGVmYXVsdCB8IHVuZGVmaW5lZH0gLSBUaGUgcmVsYXRpb25zaGlwLlxuICAgKi9cbiAgX2dldFJlbGF0aW9uc2hpcChtb2RlbENsYXNzLCByZWxhdGlvbnNoaXBOYW1lKSB7XG4gICAgcmV0dXJuIG1vZGVsQ2xhc3MuZ2V0UmVsYXRpb25zaGlwc01hcCgpW3JlbGF0aW9uc2hpcE5hbWVdXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyByZWxhdGlvbnNoaXAgd2hlcmUgb3BlcmF0b3IgdHVwbGUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IHR1cGxlVmFsdWUgLSBDYW5kaWRhdGUgdHVwbGUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdGhpcyBpcyBhIHJlbGF0aW9uc2hpcCB3aGVyZSB0dXBsZS5cbiAgICovXG4gIF9pc1JlbGF0aW9uc2hpcFdoZXJlT3BlcmF0b3JUdXBsZSh0dXBsZVZhbHVlKSB7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHR1cGxlVmFsdWUpIHx8IHR1cGxlVmFsdWUubGVuZ3RoIDwgMykge1xuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuXG4gICAgcmV0dXJuIHR5cGVvZiB0dXBsZVZhbHVlWzBdID09PSBcInN0cmluZ1wiICYmXG4gICAgICB0eXBlb2YgdHVwbGVWYWx1ZVsxXSA9PT0gXCJzdHJpbmdcIiAmJlxuICAgICAgcmVsYXRpb25zaGlwV2hlcmVPcGVyYXRvcnMuaGFzKHR1cGxlVmFsdWVbMV0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBub3JtYWxpemUgcmVsYXRpb25zaGlwIHdoZXJlIG9wZXJhdG9yIHR1cGxlcy5cbiAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gdmFsdWUgLSBDYW5kaWRhdGUgcmVsYXRpb25zaGlwIHdoZXJlIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7QXJyYXk8W3N0cmluZywgXCJlcVwiIHwgXCJub3RFcVwiIHwgXCJndFwiIHwgXCJndGVxXCIgfCBcImx0XCIgfCBcImx0ZXFcIiB8IFwibGlrZVwiLCB1bmtub3duXT59IC0gTm9ybWFsaXplZCB0dXBsZXMuXG4gICAqL1xuICBfbm9ybWFsaXplUmVsYXRpb25zaGlwV2hlcmVPcGVyYXRvclR1cGxlcyh2YWx1ZSkge1xuICAgIGlmICghQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCByZWxhdGlvbnNoaXAgd2hlcmUgdHVwbGUgY29udGFpbmVyIHR5cGU6ICR7dHlwZW9mIHZhbHVlfWApXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogTm9ybWFsaXplZC5cbiAgICAgKiBAdHlwZSB7QXJyYXk8W3N0cmluZywgXCJlcVwiIHwgXCJub3RFcVwiIHwgXCJndFwiIHwgXCJndGVxXCIgfCBcImx0XCIgfCBcImx0ZXFcIiB8IFwibGlrZVwiLCB1bmtub3duXT59ICovXG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IFtdXG4gICAgLyoqXG4gICAgICogQWRkIGNvbmRpdGlvbi5cbiAgICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBjb25kaXRpb25WYWx1ZSAtIENhbmRpZGF0ZSBuZXN0ZWQgY29uZGl0aW9uLlxuICAgICAqL1xuICAgIGNvbnN0IGFkZENvbmRpdGlvbiA9IChjb25kaXRpb25WYWx1ZSkgPT4ge1xuICAgICAgaWYgKHRoaXMuX2lzUmVsYXRpb25zaGlwV2hlcmVPcGVyYXRvclR1cGxlKGNvbmRpdGlvblZhbHVlKSkge1xuICAgICAgICBjb25zdCB0dXBsZSA9IC8qKiBAdHlwZSB7W3N0cmluZywgXCJlcVwiIHwgXCJub3RFcVwiIHwgXCJndFwiIHwgXCJndGVxXCIgfCBcImx0XCIgfCBcImx0ZXFcIiB8IFwibGlrZVwiIHwgXCI+XCIgfCBcIj49XCIgfCBcIjxcIiB8IFwiPD1cIiwgdW5rbm93biwgLi4uQXJyYXk8dW5rbm93bj5dfSAqLyAoY29uZGl0aW9uVmFsdWUpXG4gICAgICAgIGNvbnN0IG5vcm1hbGl6ZWRPcGVyYXRvciA9IG5vcm1hbGl6ZVJlbGF0aW9uc2hpcFdoZXJlT3BlcmF0b3IodHVwbGVbMV0pXG5cbiAgICAgICAgbm9ybWFsaXplZC5wdXNoKFtcbiAgICAgICAgICB0dXBsZVswXSxcbiAgICAgICAgICBub3JtYWxpemVkT3BlcmF0b3IsXG4gICAgICAgICAgdHVwbGVbMl1cbiAgICAgICAgXSlcblxuICAgICAgICBpZiAodHVwbGUubGVuZ3RoID4gMykge1xuICAgICAgICAgIGZvciAobGV0IGluZGV4ID0gMzsgaW5kZXggPCB0dXBsZS5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICAgICAgICAgIGFkZENvbmRpdGlvbih0dXBsZVtpbmRleF0pXG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGlmICghQXJyYXkuaXNBcnJheShjb25kaXRpb25WYWx1ZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUmVsYXRpb25zaGlwIHdoZXJlIGNvbmRpdGlvbnMgbXVzdCBiZSB0dXBsZXNcIilcbiAgICAgIH1cblxuICAgICAgY29uZGl0aW9uVmFsdWUuZm9yRWFjaCgobmVzdGVkQ29uZGl0aW9uVmFsdWUpID0+IHtcbiAgICAgICAgYWRkQ29uZGl0aW9uKG5lc3RlZENvbmRpdGlvblZhbHVlKVxuICAgICAgfSlcbiAgICB9XG5cbiAgICBhZGRDb25kaXRpb24odmFsdWUpXG5cbiAgICBpZiAobm9ybWFsaXplZC5sZW5ndGggPCAxKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZWxhdGlvbnNoaXAgd2hlcmUgdHVwbGUgY29udGFpbmVyIGNhbm5vdCBiZSBlbXB0eVwiKVxuICAgIH1cblxuICAgIHJldHVybiBub3JtYWxpemVkXG4gIH1cblxuICAvKipcbiAgICogUnVucyBpcyByZWxhdGlvbnNoaXAgd2hlcmUgb3BlcmF0b3IgdHVwbGUgY29udGFpbmVyLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSB2YWx1ZSAtIENhbmRpZGF0ZSByZWxhdGlvbnNoaXAgd2hlcmUgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdmFsdWUgY2FuIGJlIG5vcm1hbGl6ZWQgdG8gcmVsYXRpb25zaGlwIHR1cGxlcy5cbiAgICovXG4gIF9pc1JlbGF0aW9uc2hpcFdoZXJlT3BlcmF0b3JUdXBsZUNvbnRhaW5lcih2YWx1ZSkge1xuICAgIHRyeSB7XG4gICAgICB0aGlzLl9ub3JtYWxpemVSZWxhdGlvbnNoaXBXaGVyZU9wZXJhdG9yVHVwbGVzKHZhbHVlKVxuXG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2hlcmUgc3FsZnJvbSByZWxhdGlvbnNoaXAgd2hlcmUgb3BlcmF0b3IgdHVwbGVzLlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFJlbGF0aW9uc2hpcCB3aGVyZSBvcHRpb25zLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBpbXBvcnQoXCIuLi9yZWNvcmQvaW5kZXguanNcIikuZGVmYXVsdH0gYXJncy5tb2RlbENsYXNzIC0gUmVsYXRpb25zaGlwIG1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy50YWJsZU5hbWUgLSBSZWxhdGlvbnNoaXAgdGFibGUgcmVmZXJlbmNlIG5hbWUuXG4gICAqIEBwYXJhbSB7QXJyYXk8W3N0cmluZywgXCJlcVwiIHwgXCJub3RFcVwiIHwgXCJndFwiIHwgXCJndGVxXCIgfCBcImx0XCIgfCBcImx0ZXFcIiB8IFwibGlrZVwiLCB1bmtub3duXT59IGFyZ3MudHVwbGVzIC0gT3BlcmF0b3IgdHVwbGVzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCB3aGVyZSBmcmFnbWVudC5cbiAgICovXG4gIF93aGVyZVNRTEZyb21SZWxhdGlvbnNoaXBXaGVyZU9wZXJhdG9yVHVwbGVzKHttb2RlbENsYXNzLCB0YWJsZU5hbWUsIHR1cGxlc30pIHtcbiAgICBjb25zdCBvcHRpb25zID0gdGhpcy5nZXRPcHRpb25zKClcbiAgICBsZXQgc3FsID0gXCJcIlxuICAgIGxldCBpbmRleCA9IDBcblxuICAgIHR1cGxlcy5mb3JFYWNoKChbYXR0cmlidXRlTmFtZSwgb3BlcmF0b3IsIHdoZXJlVmFsdWVdKSA9PiB7XG4gICAgICBpZiAoaW5kZXggPiAwKSBzcWwgKz0gXCIgQU5EIFwiXG5cbiAgICAgIGNvbnN0IGNvbHVtbk5hbWUgPSB0aGlzLl9yZXNvbHZlQ29sdW1uTmFtZShtb2RlbENsYXNzLCBhdHRyaWJ1dGVOYW1lKVxuXG4gICAgICBpZiAoIWNvbHVtbk5hbWUpIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBhdHRyaWJ1dGUgXCIke2F0dHJpYnV0ZU5hbWV9XCIgZm9yICR7bW9kZWxDbGFzcy5uYW1lfWApXG5cbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWRWYWx1ZSA9IHRoaXMuX25vcm1hbGl6ZVNxbGl0ZUJvb2xlYW5WYWx1ZSh7XG4gICAgICAgIGNvbHVtbk5hbWUsXG4gICAgICAgIG1vZGVsQ2xhc3MsXG4gICAgICAgIHZhbHVlOiB3aGVyZVZhbHVlXG4gICAgICB9KVxuICAgICAgY29uc3QgdHlwZWRWYWx1ZSA9IHRoaXMuX25vcm1hbGl6ZVZhbHVlRm9yQ29sdW1uVHlwZSh7XG4gICAgICAgIGNvbHVtbk5hbWUsXG4gICAgICAgIG1vZGVsQ2xhc3MsXG4gICAgICAgIHZhbHVlOiBub3JtYWxpemVkVmFsdWVcbiAgICAgIH0pXG4gICAgICBjb25zdCBjb2x1bW5UeXBlID0gbW9kZWxDbGFzcy5nZXRDb2x1bW5UeXBlQnlOYW1lKGNvbHVtbk5hbWUpXG4gICAgICBjb25zdCBkcml2ZXJUeXBlID0gdGhpcy5nZXRRdWVyeSgpLmRyaXZlci5nZXRUeXBlKClcblxuICAgICAgaWYgKHR5cGVkVmFsdWUgPT09IE5PX01BVENIKSB7XG4gICAgICAgIGlmIChvcGVyYXRvciA9PT0gXCJub3RFcVwiKSB7XG4gICAgICAgICAgc3FsICs9IFwiMT0xXCJcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBzcWwgKz0gXCIxPTBcIlxuICAgICAgICB9XG4gICAgICAgIGluZGV4ICs9IDFcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGxldCBjb2x1bW5TcWwgPSBgJHtvcHRpb25zLnF1b3RlVGFibGVOYW1lKHRhYmxlTmFtZSl9LiR7b3B0aW9ucy5xdW90ZUNvbHVtbk5hbWUoY29sdW1uTmFtZSl9YFxuXG4gICAgICBpZiAoZHJpdmVyVHlwZSA9PSBcIm1zc3FsXCIgJiYgdHlwZW9mIHdoZXJlVmFsdWUgPT09IFwic3RyaW5nXCIgJiYgY29sdW1uVHlwZT8udG9Mb3dlckNhc2UoKSA9PSBcInRleHRcIikge1xuICAgICAgICBjb2x1bW5TcWwgPSBgQ0FTVCgke2NvbHVtblNxbH0gQVMgTlZBUkNIQVIoTUFYKSlgXG4gICAgICB9XG5cbiAgICAgIGlmIChvcGVyYXRvciA9PT0gXCJlcVwiKSB7XG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KHR5cGVkVmFsdWUpKSB7XG4gICAgICAgICAgaWYgKHR5cGVkVmFsdWUubGVuZ3RoIDwgMSkge1xuICAgICAgICAgICAgc3FsICs9IFwiMT0wXCJcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgc3FsICs9IGAke2NvbHVtblNxbH0gSU4gKCR7dHlwZWRWYWx1ZS5tYXAoKHZhbHVlKSA9PiBvcHRpb25zLnF1b3RlKHZhbHVlKSkuam9pbihcIiwgXCIpfSlgXG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKHR5cGVkVmFsdWUgPT09IG51bGwpIHtcbiAgICAgICAgICBzcWwgKz0gYCR7Y29sdW1uU3FsfSBJUyBOVUxMYFxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHNxbCArPSBgJHtjb2x1bW5TcWx9ID0gJHtvcHRpb25zLnF1b3RlKHR5cGVkVmFsdWUpfWBcbiAgICAgICAgfVxuXG4gICAgICAgIGluZGV4ICs9IDFcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGlmIChvcGVyYXRvciA9PT0gXCJub3RFcVwiKSB7XG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KHR5cGVkVmFsdWUpKSB7XG4gICAgICAgICAgaWYgKHR5cGVkVmFsdWUubGVuZ3RoIDwgMSkge1xuICAgICAgICAgICAgc3FsICs9IFwiMT0xXCJcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgc3FsICs9IGAke2NvbHVtblNxbH0gTk9UIElOICgke3R5cGVkVmFsdWUubWFwKCh2YWx1ZSkgPT4gb3B0aW9ucy5xdW90ZSh2YWx1ZSkpLmpvaW4oXCIsIFwiKX0pYFxuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmICh0eXBlZFZhbHVlID09PSBudWxsKSB7XG4gICAgICAgICAgc3FsICs9IGAke2NvbHVtblNxbH0gSVMgTk9UIE5VTExgXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgc3FsICs9IGAke2NvbHVtblNxbH0gIT0gJHtvcHRpb25zLnF1b3RlKHR5cGVkVmFsdWUpfWBcbiAgICAgICAgfVxuXG4gICAgICAgIGluZGV4ICs9IDFcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIGlmIChBcnJheS5pc0FycmF5KHR5cGVkVmFsdWUpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgT3BlcmF0b3IgXCIke29wZXJhdG9yfVwiIGRvZXMgbm90IHN1cHBvcnQgYXJyYXkgdmFsdWVzIGZvciAke21vZGVsQ2xhc3MubmFtZX0uJHthdHRyaWJ1dGVOYW1lfWApXG4gICAgICB9XG5cbiAgICAgIGlmICh0eXBlZFZhbHVlID09PSBudWxsKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgT3BlcmF0b3IgXCIke29wZXJhdG9yfVwiIGRvZXMgbm90IHN1cHBvcnQgbnVsbCB2YWx1ZXMgZm9yICR7bW9kZWxDbGFzcy5uYW1lfS4ke2F0dHJpYnV0ZU5hbWV9YClcbiAgICAgIH1cblxuICAgICAgY29uc3Qgb3BlcmF0b3JNYXAgPSB7XG4gICAgICAgIGd0OiBcIj5cIixcbiAgICAgICAgZ3RlcTogXCI+PVwiLFxuICAgICAgICBsaWtlOiBcIkxJS0VcIixcbiAgICAgICAgbHQ6IFwiPFwiLFxuICAgICAgICBsdGVxOiBcIjw9XCJcbiAgICAgIH1cblxuICAgICAgc3FsICs9IGAke2NvbHVtblNxbH0gJHtvcGVyYXRvck1hcFtvcGVyYXRvcl19ICR7b3B0aW9ucy5xdW90ZSh0eXBlZFZhbHVlKX1gXG4gICAgICBpbmRleCArPSAxXG4gICAgfSlcblxuICAgIHJldHVybiBzcWxcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSBzcWxpdGUgYm9vbGVhbiB2YWx1ZS5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBPcHRpb25zIG9iamVjdC5cbiAgICogQHBhcmFtIHt0eXBlb2YgaW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHR9IGFyZ3MubW9kZWxDbGFzcyAtIE1vZGVsIGNsYXNzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5jb2x1bW5OYW1lIC0gQ29sdW1uIG5hbWUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MudmFsdWUgLSBWYWx1ZSB0byBub3JtYWxpemUuXG4gICAqIEByZXR1cm5zIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gLSBOb3JtYWxpemVkIHZhbHVlLlxuICAgKi9cbiAgX25vcm1hbGl6ZVNxbGl0ZUJvb2xlYW5WYWx1ZSh7bW9kZWxDbGFzcywgY29sdW1uTmFtZSwgdmFsdWV9KSB7XG4gICAgaWYgKG1vZGVsQ2xhc3MuZ2V0RGF0YWJhc2VUeXBlKCkgIT0gXCJzcWxpdGVcIikgcmV0dXJuIHZhbHVlXG5cbiAgICBjb25zdCBjb2x1bW5UeXBlID0gbW9kZWxDbGFzcy5nZXRDb2x1bW5UeXBlQnlOYW1lKGNvbHVtbk5hbWUpXG5cbiAgICBpZiAoIWNvbHVtblR5cGUpIHJldHVybiB2YWx1ZVxuICAgIGlmIChjb2x1bW5UeXBlLnRvTG93ZXJDYXNlKCkgIT09IFwiYm9vbGVhblwiKSByZXR1cm4gdmFsdWVcblxuICAgIC8qKlxuICAgICAqIE5vcm1hbGl6ZS5cbiAgICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBlbnRyeSAtIFZhbHVlIHRvIG5vcm1hbGl6ZS5cbiAgICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gU1FMaXRlIHByZWRpY2F0ZSB2YWx1ZSB3aXRoIGJvb2xlYW5zIGVuY29kZWQgYXMgMSBvciAwLlxuICAgICAqL1xuICAgIGNvbnN0IG5vcm1hbGl6ZSA9IChlbnRyeSkgPT4ge1xuICAgICAgaWYgKGVudHJ5ID09PSB0cnVlKSByZXR1cm4gMVxuICAgICAgaWYgKGVudHJ5ID09PSBmYWxzZSkgcmV0dXJuIDBcbiAgICAgIHJldHVybiBlbnRyeVxuICAgIH1cblxuICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgcmV0dXJuIHZhbHVlLm1hcCgoZW50cnkpID0+IG5vcm1hbGl6ZShlbnRyeSkpXG4gICAgfVxuXG4gICAgcmV0dXJuIG5vcm1hbGl6ZSh2YWx1ZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIG5vcm1hbGl6ZSB2YWx1ZSBmb3IgY29sdW1uIHR5cGUuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBhcmdzLm1vZGVsQ2xhc3MgLSBNb2RlbCBjbGFzcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuY29sdW1uTmFtZSAtIENvbHVtbiBuYW1lLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhcmdzLnZhbHVlIC0gVmFsdWUgdG8gbm9ybWFsaXplLlxuICAgKiBAcmV0dXJucyB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IC0gTm9ybWFsaXplZCB2YWx1ZS5cbiAgICovXG4gIF9ub3JtYWxpemVWYWx1ZUZvckNvbHVtblR5cGUoe21vZGVsQ2xhc3MsIGNvbHVtbk5hbWUsIHZhbHVlfSkge1xuICAgIGNvbnN0IGNvbHVtblR5cGUgPSBtb2RlbENsYXNzLmdldENvbHVtblR5cGVCeU5hbWUoY29sdW1uTmFtZSlcblxuICAgIGlmICghY29sdW1uVHlwZSkgcmV0dXJuIHZhbHVlXG5cbiAgICBjb25zdCBub3JtYWxpemVkVHlwZSA9IGNvbHVtblR5cGUudG9Mb3dlckNhc2UoKVxuICAgIGNvbnN0IHN0cmluZ1R5cGVzID0gbmV3IFNldChbXCJjaGFyXCIsIFwidmFyY2hhclwiLCBcIm52YXJjaGFyXCIsIFwic3RyaW5nXCIsIFwiZW51bVwiLCBcImpzb25cIiwgXCJqc29uYlwiLCBcImNpdGV4dFwiLCBcImJpbmFyeVwiLCBcInZhcmJpbmFyeVwiLCBcImNoYXJhY3RlciB2YXJ5aW5nXCJdKVxuICAgIGNvbnN0IGlzVXVpZFR5cGUgPSBub3JtYWxpemVkVHlwZS5pbmNsdWRlcyhcInV1aWRcIilcbiAgICBjb25zdCBzaG91bGRDb2VyY2VUb1N0cmluZyA9IG5vcm1hbGl6ZWRUeXBlLmluY2x1ZGVzKFwidXVpZFwiKSB8fFxuICAgICAgbm9ybWFsaXplZFR5cGUuaW5jbHVkZXMoXCJ0ZXh0XCIpIHx8XG4gICAgICBzdHJpbmdUeXBlcy5oYXMobm9ybWFsaXplZFR5cGUpXG5cbiAgICAvKipcbiAgICAgKiBOb3JtYWxpemUuXG4gICAgICogQHBhcmFtIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gZW50cnkgLSBWYWx1ZSB0byBub3JtYWxpemUuXG4gICAgICogQHJldHVybnMge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSAtIENvbHVtbi1jb21wYXRpYmxlIHByZWRpY2F0ZSB2YWx1ZSwgb3IgdGhlIG5vLW1hdGNoIHNlbnRpbmVsIGZvciBudW1lcmljIFVVSURzLlxuICAgICAqL1xuICAgIGNvbnN0IG5vcm1hbGl6ZSA9IChlbnRyeSkgPT4ge1xuICAgICAgaWYgKGlzVXVpZFR5cGUgJiYgdHlwZW9mIGVudHJ5ID09PSBcIm51bWJlclwiKSByZXR1cm4gTk9fTUFUQ0hcbiAgICAgIGlmICghc2hvdWxkQ29lcmNlVG9TdHJpbmcgfHwgdHlwZW9mIGVudHJ5ICE9PSBcIm51bWJlclwiKSByZXR1cm4gZW50cnlcblxuICAgICAgcmV0dXJuIFN0cmluZyhlbnRyeSlcbiAgICB9XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSB2YWx1ZS5tYXAoKGVudHJ5KSA9PiBub3JtYWxpemUoZW50cnkpKS5maWx0ZXIoKGVudHJ5KSA9PiBlbnRyeSAhPT0gTk9fTUFUQ0gpXG5cbiAgICAgIGlmIChpc1V1aWRUeXBlICYmIG5vcm1hbGl6ZWQubGVuZ3RoID09PSAwKSByZXR1cm4gTk9fTUFUQ0hcblxuICAgICAgcmV0dXJuIG5vcm1hbGl6ZWRcbiAgICB9XG5cbiAgICBjb25zdCBub3JtYWxpemVkID0gbm9ybWFsaXplKHZhbHVlKVxuXG4gICAgaWYgKG5vcm1hbGl6ZWQgPT09IE5PX01BVENIKSByZXR1cm4gTk9fTUFUQ0hcblxuICAgIHJldHVybiBub3JtYWxpemVkXG4gIH1cblxuICAvKipcbiAgICogTm9ybWFsaXplcyBleHBsaWNpdCBtZW1iZXJzaGlwIHRocm91Z2ggdGhlIG1vZGVsJ3MgY29sdW1uIG1ldGFkYXRhLlxuICAgKiBAcGFyYW0ge3ttb2RlbENsYXNzOiB0eXBlb2YgaW1wb3J0KFwiLi4vcmVjb3JkL2luZGV4LmpzXCIpLmRlZmF1bHQsIGNvbHVtbk5hbWU6IHN0cmluZywgdGFibGVOYW1lPzogc3RyaW5nLCBjb25kaXRpb246IHVua25vd259fSBhcmdzIC0gUmVzb2x2ZWQgY29sdW1uIGFuZCB1bnRydXN0ZWQgbWVtYmVyc2hpcCBkZXNjcmlwdG9yLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIENvbXBsZXRlIGNvbHVtbiBtZW1iZXJzaGlwIHByZWRpY2F0ZS5cbiAgICovXG4gIF93aGVyZVNRTEZyb21JbkNvbmRpdGlvbih7bW9kZWxDbGFzcywgY29sdW1uTmFtZSwgdGFibGVOYW1lLCBjb25kaXRpb259KSB7XG4gICAgY29uc3Qgb3B0aW9ucyA9IHRoaXMuZ2V0T3B0aW9ucygpXG4gICAgY29uc3QgdmFsdWVzID0gV2hlcmVJbi52YWx1ZXMoY29uZGl0aW9uKVxuICAgIGNvbnN0IG5vcm1hbGl6ZWRWYWx1ZXMgPSB0aGlzLl9ub3JtYWxpemVTcWxpdGVCb29sZWFuVmFsdWUoe2NvbHVtbk5hbWUsIG1vZGVsQ2xhc3MsIHZhbHVlOiB2YWx1ZXN9KVxuICAgIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi93aGVyZS1pbi5qc1wiKS5JblZhbHVlW10gfCB0eXBlb2YgTk9fTUFUQ0h9ICovXG4gICAgY29uc3QgdHlwZWRWYWx1ZXMgPSB0aGlzLl9ub3JtYWxpemVWYWx1ZUZvckNvbHVtblR5cGUoe2NvbHVtbk5hbWUsIG1vZGVsQ2xhc3MsIHZhbHVlOiBub3JtYWxpemVkVmFsdWVzfSlcblxuICAgIGlmICh0eXBlZFZhbHVlcyA9PT0gTk9fTUFUQ0gpIHJldHVybiBcIjE9MFwiXG5cbiAgICBjb25zdCBjb2x1bW5TcWwgPSB0YWJsZU5hbWVcbiAgICAgID8gYCR7b3B0aW9ucy5xdW90ZVRhYmxlTmFtZSh0YWJsZU5hbWUpfS4ke29wdGlvbnMucXVvdGVDb2x1bW5OYW1lKGNvbHVtbk5hbWUpfWBcbiAgICAgIDogb3B0aW9ucy5xdW90ZUNvbHVtbk5hbWUoY29sdW1uTmFtZSlcbiAgICBjb25zdCBjb2x1bW5UeXBlID0gbW9kZWxDbGFzcy5nZXRDb2x1bW5UeXBlQnlOYW1lKGNvbHVtbk5hbWUpXG4gICAgY29uc3QgY2FzdFRleHQgPSB0aGlzLmdldFF1ZXJ5KCkuZHJpdmVyLmdldFR5cGUoKSA9PT0gXCJtc3NxbFwiICYmIGNvbHVtblR5cGU/LnRvTG93ZXJDYXNlKCkgPT09IFwidGV4dFwiXG5cbiAgICByZXR1cm4gV2hlcmVJbi50b1NxbCh7XG4gICAgICBjb2x1bW5TcWwsXG4gICAgICBpbkNvbHVtblNxbDogY2FzdFRleHQgPyBgQ0FTVCgke2NvbHVtblNxbH0gQVMgTlZBUkNIQVIoTUFYKSlgIDogY29sdW1uU3FsLFxuICAgICAgb3B0aW9ucyxcbiAgICAgIHZhbHVlczogdHlwZWRWYWx1ZXNcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2hlcmUgc3FsZnJvbSBoYXNoLlxuICAgKiBAcGFyYW0ge1doZXJlSGFzaH0gaGFzaCAtIEhhc2guXG4gICAqIEBwYXJhbSB7dHlwZW9mIGltcG9ydChcIi4uL3JlY29yZC9pbmRleC5qc1wiKS5kZWZhdWx0fSBtb2RlbENsYXNzIC0gTW9kZWwgY2xhc3MuXG4gICAqIEBwYXJhbSB7c3RyaW5nW119IHBhdGggLSBKb2luIHBhdGguXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbdGFibGVOYW1lXSAtIFRhYmxlIG5hbWUuXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBpbmRleCAtIEluZGV4IHZhbHVlLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFNRTCBzdHJpbmcuXG4gICAqL1xuICBfd2hlcmVTUUxGcm9tSGFzaChoYXNoLCBtb2RlbENsYXNzLCBwYXRoLCB0YWJsZU5hbWUsIGluZGV4ID0gMCkge1xuICAgIGNvbnN0IG9wdGlvbnMgPSB0aGlzLmdldE9wdGlvbnMoKVxuICAgIGNvbnN0IG1vZGVsUXVlcnkgPSAvKiogQHR5cGUge2ltcG9ydChcIi4vbW9kZWwtY2xhc3MtcXVlcnkuanNcIikuZGVmYXVsdH0gKi8gKHRoaXMucXVlcnkpXG4gICAgbGV0IHNxbCA9IFwiXCJcblxuICAgIGZvciAoY29uc3Qgd2hlcmVLZXkgaW4gaGFzaCkge1xuICAgICAgY29uc3Qgd2hlcmVWYWx1ZSA9IGhhc2hbd2hlcmVLZXldXG4gICAgICBjb25zdCByZWxhdGlvbnNoaXAgPSB0aGlzLl9nZXRSZWxhdGlvbnNoaXAobW9kZWxDbGFzcywgd2hlcmVLZXkpXG4gICAgICBjb25zdCB0dXBsZXMgPSB0aGlzLl9pc1JlbGF0aW9uc2hpcFdoZXJlT3BlcmF0b3JUdXBsZUNvbnRhaW5lcih3aGVyZVZhbHVlKVxuICAgICAgICA/IHRoaXMuX25vcm1hbGl6ZVJlbGF0aW9uc2hpcFdoZXJlT3BlcmF0b3JUdXBsZXMod2hlcmVWYWx1ZSlcbiAgICAgICAgOiBudWxsXG4gICAgICBjb25zdCByZXNvbHZlZENvbHVtbk5hbWUgPSB0aGlzLl9yZXNvbHZlQ29sdW1uTmFtZShtb2RlbENsYXNzLCB3aGVyZUtleSlcblxuICAgICAgaWYgKHJlc29sdmVkQ29sdW1uTmFtZSAmJiAhcmVsYXRpb25zaGlwICYmIGlzUGxhaW5PYmplY3Qod2hlcmVWYWx1ZSkpIHtcbiAgICAgICAgaWYgKGluZGV4ID4gMCkgc3FsICs9IFwiIEFORCBcIlxuXG4gICAgICAgIHNxbCArPSB0aGlzLl93aGVyZVNRTEZyb21JbkNvbmRpdGlvbih7Y29sdW1uTmFtZTogcmVzb2x2ZWRDb2x1bW5OYW1lLCBjb25kaXRpb246IHdoZXJlVmFsdWUsIG1vZGVsQ2xhc3MsIHRhYmxlTmFtZX0pXG4gICAgICB9IGVsc2UgaWYgKHJlbGF0aW9uc2hpcCAmJiB0dXBsZXMpIHtcbiAgICAgICAgaWYgKGluZGV4ID4gMCkgc3FsICs9IFwiIEFORCBcIlxuXG4gICAgICAgIGNvbnN0IHJhd1RhcmdldE1vZGVsQ2xhc3MgPSByZWxhdGlvbnNoaXAuZ2V0VGFyZ2V0TW9kZWxDbGFzcygpXG5cbiAgICAgICAgaWYgKCFyYXdUYXJnZXRNb2RlbENsYXNzKSB0aHJvdyBuZXcgRXJyb3IoYFJlbGF0aW9uc2hpcCBcIiR7d2hlcmVLZXl9XCIgZm9yICR7bW9kZWxDbGFzcy5uYW1lfSBoYXMgbm8gdGFyZ2V0IG1vZGVsIGNsYXNzYClcblxuICAgICAgICBjb25zdCB0YXJnZXRNb2RlbENsYXNzID0gbW9kZWxDbGFzcy5iaW5kUmVjb3JkTWV0YWRhdGFNb2RlbENsYXNzKHJhd1RhcmdldE1vZGVsQ2xhc3MpXG5cbiAgICAgICAgY29uc3QgbmVzdGVkUGF0aCA9IHBhdGguY29uY2F0KFt3aGVyZUtleV0pXG4gICAgICAgIGNvbnN0IG5lc3RlZFRhYmxlTmFtZSA9IG1vZGVsUXVlcnkuZ2V0VGFibGVSZWZlcmVuY2VGb3JKb2luKC4uLm5lc3RlZFBhdGgpXG5cbiAgICAgICAgc3FsICs9IHRoaXMuX3doZXJlU1FMRnJvbVJlbGF0aW9uc2hpcFdoZXJlT3BlcmF0b3JUdXBsZXMoe1xuICAgICAgICAgIG1vZGVsQ2xhc3M6IHRhcmdldE1vZGVsQ2xhc3MsXG4gICAgICAgICAgdGFibGVOYW1lOiBuZXN0ZWRUYWJsZU5hbWUsXG4gICAgICAgICAgdHVwbGVzXG4gICAgICAgIH0pXG4gICAgICB9IGVsc2UgaWYgKHJlc29sdmVkQ29sdW1uTmFtZSAmJiB0dXBsZXMpIHtcbiAgICAgICAgaWYgKGluZGV4ID4gMCkgc3FsICs9IFwiIEFORCBcIlxuXG4gICAgICAgIHNxbCArPSB0aGlzLl93aGVyZVNRTEZyb21SZWxhdGlvbnNoaXBXaGVyZU9wZXJhdG9yVHVwbGVzKHtcbiAgICAgICAgICBtb2RlbENsYXNzLFxuICAgICAgICAgIHRhYmxlTmFtZTogdGFibGVOYW1lIHx8IG1vZGVsUXVlcnkuZ2V0VGFibGVSZWZlcmVuY2VGb3JKb2luKC4uLnBhdGgpLFxuICAgICAgICAgIHR1cGxlc1xuICAgICAgICB9KVxuICAgICAgfSBlbHNlIGlmIChBcnJheS5pc0FycmF5KHdoZXJlVmFsdWUpICYmIHdoZXJlVmFsdWUubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIGlmIChpbmRleCA+IDApIHNxbCArPSBcIiBBTkQgXCJcbiAgICAgICAgc3FsICs9IFwiMT0wXCJcbiAgICAgIH0gZWxzZSBpZiAoaXNQbGFpbk9iamVjdCh3aGVyZVZhbHVlKSkge1xuICAgICAgICBpZiAoIXJlbGF0aW9uc2hpcCkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biByZWxhdGlvbnNoaXAgXCIke3doZXJlS2V5fVwiIGZvciAke21vZGVsQ2xhc3MubmFtZX1gKVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcmF3VGFyZ2V0TW9kZWxDbGFzcyA9IHJlbGF0aW9uc2hpcC5nZXRUYXJnZXRNb2RlbENsYXNzKClcblxuICAgICAgICBpZiAoIXJhd1RhcmdldE1vZGVsQ2xhc3MpIHRocm93IG5ldyBFcnJvcihgUmVsYXRpb25zaGlwIFwiJHt3aGVyZUtleX1cIiBmb3IgJHttb2RlbENsYXNzLm5hbWV9IGhhcyBubyB0YXJnZXQgbW9kZWwgY2xhc3NgKVxuXG4gICAgICAgIGNvbnN0IHRhcmdldE1vZGVsQ2xhc3MgPSBtb2RlbENsYXNzLmJpbmRSZWNvcmRNZXRhZGF0YU1vZGVsQ2xhc3MocmF3VGFyZ2V0TW9kZWxDbGFzcylcblxuICAgICAgICBjb25zdCBuZXN0ZWRIYXNoID0gLyoqIEB0eXBlIHtXaGVyZUhhc2h9ICovICh3aGVyZVZhbHVlKVxuICAgICAgICBjb25zdCBuZXN0ZWRQYXRoID0gcGF0aC5jb25jYXQoW3doZXJlS2V5XSlcbiAgICAgICAgY29uc3QgbmVzdGVkVGFibGVOYW1lID0gbW9kZWxRdWVyeS5nZXRUYWJsZVJlZmVyZW5jZUZvckpvaW4oLi4ubmVzdGVkUGF0aClcblxuICAgICAgICBzcWwgKz0gdGhpcy5fd2hlcmVTUUxGcm9tSGFzaChuZXN0ZWRIYXNoLCB0YXJnZXRNb2RlbENsYXNzLCBuZXN0ZWRQYXRoLCBuZXN0ZWRUYWJsZU5hbWUsIGluZGV4KVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKGluZGV4ID4gMCkgc3FsICs9IFwiIEFORCBcIlxuXG4gICAgICAgIGNvbnN0IGNvbHVtbk5hbWUgPSB0aGlzLl9yZXNvbHZlQ29sdW1uTmFtZShtb2RlbENsYXNzLCB3aGVyZUtleSlcblxuICAgICAgICBpZiAoIWNvbHVtbk5hbWUpIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBhdHRyaWJ1dGUgXCIke3doZXJlS2V5fVwiIGZvciAke21vZGVsQ2xhc3MubmFtZX1gKVxuXG4gICAgICAgIGNvbnN0IGNvbHVtblR5cGUgPSBtb2RlbENsYXNzLmdldENvbHVtblR5cGVCeU5hbWUoY29sdW1uTmFtZSlcblxuICAgICAgICBjb25zdCBub3JtYWxpemVkVmFsdWUgPSB0aGlzLl9ub3JtYWxpemVTcWxpdGVCb29sZWFuVmFsdWUoe1xuICAgICAgICAgIGNvbHVtbk5hbWUsXG4gICAgICAgICAgbW9kZWxDbGFzcyxcbiAgICAgICAgICB2YWx1ZTogd2hlcmVWYWx1ZVxuICAgICAgICB9KVxuICAgICAgICBjb25zdCB0eXBlZFZhbHVlID0gdGhpcy5fbm9ybWFsaXplVmFsdWVGb3JDb2x1bW5UeXBlKHtcbiAgICAgICAgICBjb2x1bW5OYW1lLFxuICAgICAgICAgIG1vZGVsQ2xhc3MsXG4gICAgICAgICAgdmFsdWU6IG5vcm1hbGl6ZWRWYWx1ZVxuICAgICAgICB9KVxuXG4gICAgICAgIGlmICh0eXBlZFZhbHVlID09PSBOT19NQVRDSCkge1xuICAgICAgICAgIHNxbCArPSBcIjE9MFwiXG4gICAgICAgICAgaW5kZXgrK1xuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cblxuICAgICAgICBsZXQgY29sdW1uU3FsID0gYCR7b3B0aW9ucy5xdW90ZUNvbHVtbk5hbWUoY29sdW1uTmFtZSl9YFxuXG4gICAgICAgIGlmICh0YWJsZU5hbWUpIHtcbiAgICAgICAgICBjb2x1bW5TcWwgPSBgJHtvcHRpb25zLnF1b3RlVGFibGVOYW1lKHRhYmxlTmFtZSl9LiR7Y29sdW1uU3FsfWBcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGRyaXZlclR5cGUgPSB0aGlzLmdldFF1ZXJ5KCkuZHJpdmVyLmdldFR5cGUoKVxuXG4gICAgICAgIGlmIChkcml2ZXJUeXBlID09IFwibXNzcWxcIiAmJiB0eXBlb2Ygd2hlcmVWYWx1ZSA9PT0gXCJzdHJpbmdcIiAmJiBjb2x1bW5UeXBlPy50b0xvd2VyQ2FzZSgpID09IFwidGV4dFwiKSB7XG4gICAgICAgICAgY29sdW1uU3FsID0gYENBU1QoJHtjb2x1bW5TcWx9IEFTIE5WQVJDSEFSKE1BWCkpYFxuICAgICAgICB9XG5cbiAgICAgICAgc3FsICs9IGNvbHVtblNxbFxuXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KHR5cGVkVmFsdWUpKSB7XG4gICAgICAgICAgc3FsICs9IGAgSU4gKCR7dHlwZWRWYWx1ZS5tYXAoKHZhbHVlKSA9PiBvcHRpb25zLnF1b3RlKHZhbHVlKSkuam9pbihcIiwgXCIpfSlgXG4gICAgICAgIH0gZWxzZSBpZiAodHlwZWRWYWx1ZSA9PT0gbnVsbCkge1xuICAgICAgICAgIHNxbCArPSBcIiBJUyBOVUxMXCJcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBzcWwgKz0gYCA9ICR7b3B0aW9ucy5xdW90ZSh0eXBlZFZhbHVlKX1gXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaW5kZXgrK1xuICAgIH1cblxuICAgIHJldHVybiBzcWxcbiAgfVxufVxuIl19