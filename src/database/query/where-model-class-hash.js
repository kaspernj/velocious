// @ts-check

import {isPlainObject} from "is-plain-object"
import WhereBase from "./where-base.js"

/**
 * @typedef {{[key: string]: string | number | boolean | null | Array<string | number | boolean | null> | Record<string, any>}} WhereHash
 */

const NO_MATCH = Symbol("no-match")
const relationshipWhereOperators = new Set(["eq", "notEq", "gt", "gteq", "lt", "lteq", "like"])

export default class VelociousDatabaseQueryWhereModelClassHash extends WhereBase {
  /**
   * @param {object} args - Options object.
   * @param {import("./index.js").default} args.query - Query instance.
   * @param {WhereHash} args.hash - Hash.
   * @param {typeof import("../record/index.js").default} args.modelClass - Model class.
   * @param {boolean} [args.qualifyBaseTable] - Whether to qualify base table columns.
   */
  constructor({query, hash, modelClass, qualifyBaseTable = false}) {
    super()
    this.hash = hash
    this.modelClass = modelClass
    this.qualifyBaseTable = qualifyBaseTable
    this.query = query
  }

  /**
   * @returns {typeof import("../record/index.js").default} - The model class.
   */
  getModelClass() {
    if (!this.modelClass) throw new Error("modelClass not set")

    return this.modelClass
  }

  /**
   * @returns {string} - SQL string.
   */
  toSql() {
    let sql = "("

    const modelQuery = /** @type {import("./model-class-query.js").default} */ (this.query)
    const baseTableName = this.qualifyBaseTable
      ? modelQuery.getTableReferenceForJoin()
      : undefined

    sql += this._whereSQLFromHash(this.hash, this.getModelClass(), [], baseTableName)
    sql += ")"

    return sql
  }

  /**
   * @param {typeof import("../record/index.js").default} modelClass - Model class.
   * @param {string} key - Attribute or column name.
   * @returns {string | undefined} - The resolved column name.
   */
  _resolveColumnName(modelClass, key) {
    const attributeMap = modelClass.getAttributeNameToColumnNameMap()
    const columnName = attributeMap[key]

    if (columnName) return columnName

    return undefined
  }

  /**
   * @param {typeof import("../record/index.js").default} modelClass - Model class.
   * @param {string} relationshipName - Relationship name.
   * @returns {import("../record/relationships/base.js").default | undefined} - The relationship.
   */
  _getRelationship(modelClass, relationshipName) {
    return modelClass.getRelationshipsMap()[relationshipName]
  }

  /**
   * @param {unknown} tupleValue - Candidate tuple.
   * @returns {boolean} - Whether this is a relationship where tuple.
   */
  _isRelationshipWhereOperatorTuple(tupleValue) {
    if (!Array.isArray(tupleValue) || tupleValue.length < 3) {
      return false
    }

    return typeof tupleValue[0] === "string" &&
      typeof tupleValue[1] === "string" &&
      relationshipWhereOperators.has(tupleValue[1])
  }

  /**
   * @param {unknown} value - Candidate relationship where value.
   * @returns {Array<[string, "eq" | "notEq" | "gt" | "gteq" | "lt" | "lteq" | "like", any]>} - Normalized tuples.
   */
  _normalizeRelationshipWhereOperatorTuples(value) {
    if (!Array.isArray(value)) {
      throw new Error(`Invalid relationship where tuple container type: ${typeof value}`)
    }

    /** @type {Array<[string, "eq" | "notEq" | "gt" | "gteq" | "lt" | "lteq" | "like", any]>} */
    const normalized = []
    const addCondition = (conditionValue) => {
      if (this._isRelationshipWhereOperatorTuple(conditionValue)) {
        normalized.push([
          conditionValue[0],
          /** @type {"eq" | "notEq" | "gt" | "gteq" | "lt" | "lteq" | "like"} */ (conditionValue[1]),
          conditionValue[2]
        ])

        if (conditionValue.length > 3) {
          for (let index = 3; index < conditionValue.length; index += 1) {
            addCondition(conditionValue[index])
          }
        }

        return
      }

      if (!Array.isArray(conditionValue)) {
        throw new Error("Relationship where conditions must be tuples")
      }

      conditionValue.forEach((nestedConditionValue) => {
        addCondition(nestedConditionValue)
      })
    }

    addCondition(value)

    if (normalized.length < 1) {
      throw new Error("Relationship where tuple container cannot be empty")
    }

    return normalized
  }

  /**
   * @param {unknown} value - Candidate relationship where value.
   * @returns {boolean} - Whether value can be normalized to relationship tuples.
   */
  _isRelationshipWhereOperatorTupleContainer(value) {
    try {
      this._normalizeRelationshipWhereOperatorTuples(value)

      return true
    } catch {
      return false
    }
  }

  /**
   * @param {object} args - Relationship where options.
   * @param {typeof import("../record/index.js").default} args.modelClass - Relationship model class.
   * @param {string} args.tableName - Relationship table reference name.
   * @param {Array<[string, "eq" | "notEq" | "gt" | "gteq" | "lt" | "lteq" | "like", any]>} args.tuples - Operator tuples.
   * @returns {string} - SQL where fragment.
   */
  _whereSQLFromRelationshipWhereOperatorTuples({modelClass, tableName, tuples}) {
    const options = this.getOptions()
    let sql = ""
    let index = 0

    tuples.forEach(([attributeName, operator, whereValue]) => {
      if (index > 0) sql += " AND "

      const columnName = this._resolveColumnName(modelClass, attributeName)

      if (!columnName) throw new Error(`Unknown attribute "${attributeName}" for ${modelClass.name}`)

      const normalizedValue = this._normalizeSqliteBooleanValue({
        columnName,
        modelClass,
        value: whereValue
      })
      const typedValue = this._normalizeValueForColumnType({
        columnName,
        modelClass,
        value: normalizedValue
      })
      const columnType = modelClass.getColumnTypeByName(columnName)
      const driverType = this.getQuery().driver.getType()

      if (typedValue === NO_MATCH) {
        if (operator === "notEq") {
          sql += "1=1"
        } else {
          sql += "1=0"
        }
        index += 1
        return
      }

      let columnSql = `${options.quoteTableName(tableName)}.${options.quoteColumnName(columnName)}`

      if (driverType == "mssql" && typeof whereValue === "string" && columnType?.toLowerCase() == "text") {
        columnSql = `CAST(${columnSql} AS NVARCHAR(MAX))`
      }

      if (operator === "eq") {
        if (Array.isArray(typedValue)) {
          if (typedValue.length < 1) {
            sql += "1=0"
          } else {
            sql += `${columnSql} IN (${typedValue.map((value) => options.quote(value)).join(", ")})`
          }
        } else if (typedValue === null) {
          sql += `${columnSql} IS NULL`
        } else {
          sql += `${columnSql} = ${options.quote(typedValue)}`
        }

        index += 1
        return
      }

      if (operator === "notEq") {
        if (Array.isArray(typedValue)) {
          if (typedValue.length < 1) {
            sql += "1=1"
          } else {
            sql += `${columnSql} NOT IN (${typedValue.map((value) => options.quote(value)).join(", ")})`
          }
        } else if (typedValue === null) {
          sql += `${columnSql} IS NOT NULL`
        } else {
          sql += `${columnSql} != ${options.quote(typedValue)}`
        }

        index += 1
        return
      }

      if (Array.isArray(typedValue)) {
        throw new Error(`Operator "${operator}" does not support array values for ${modelClass.name}.${attributeName}`)
      }

      if (typedValue === null) {
        throw new Error(`Operator "${operator}" does not support null values for ${modelClass.name}.${attributeName}`)
      }

      const operatorMap = {
        gt: ">",
        gteq: ">=",
        like: "LIKE",
        lt: "<",
        lteq: "<="
      }

      sql += `${columnSql} ${operatorMap[operator]} ${options.quote(typedValue)}`
      index += 1
    })

    return sql
  }

  /**
   * @param {object} args - Options object.
   * @param {typeof import("../record/index.js").default} args.modelClass - Model class.
   * @param {string} args.columnName - Column name.
   * @param {any} args.value - Value to normalize.
   * @returns {any} - Normalized value.
   */
  _normalizeSqliteBooleanValue({modelClass, columnName, value}) {
    if (modelClass.getDatabaseType() != "sqlite") return value

    const columnType = modelClass.getColumnTypeByName(columnName)

    if (!columnType || typeof columnType != "string") return value
    if (columnType.toLowerCase() !== "boolean") return value

    const normalize = (entry) => {
      if (entry === true) return 1
      if (entry === false) return 0
      return entry
    }

    if (Array.isArray(value)) {
      return value.map((entry) => normalize(entry))
    }

    return normalize(value)
  }

  /**
   * @param {object} args - Options object.
   * @param {typeof import("../record/index.js").default} args.modelClass - Model class.
   * @param {string} args.columnName - Column name.
   * @param {any} args.value - Value to normalize.
   * @returns {any} - Normalized value.
   */
  _normalizeValueForColumnType({modelClass, columnName, value}) {
    const columnType = modelClass.getColumnTypeByName(columnName)

    if (!columnType || typeof columnType != "string") return value

    const normalizedType = columnType.toLowerCase()
    const stringTypes = new Set(["char", "varchar", "nvarchar", "string", "enum", "json", "jsonb", "citext", "binary", "varbinary"])
    const isUuidType = normalizedType.includes("uuid")
    const shouldCoerceToString = normalizedType.includes("uuid") ||
      normalizedType.includes("text") ||
      stringTypes.has(normalizedType)

    const normalize = (entry) => {
      if (isUuidType && typeof entry === "number") return NO_MATCH
      if (!shouldCoerceToString || typeof entry !== "number") return entry

      return String(entry)
    }

    if (Array.isArray(value)) {
      const normalized = value.map((entry) => normalize(entry)).filter((entry) => entry !== NO_MATCH)

      if (isUuidType && normalized.length === 0) return NO_MATCH

      return normalized
    }

    const normalized = normalize(value)

    if (normalized === NO_MATCH) return NO_MATCH

    return normalized
  }

  /**
   * @param {WhereHash} hash - Hash.
   * @param {typeof import("../record/index.js").default} modelClass - Model class.
   * @param {string[]} path - Join path.
   * @param {string} [tableName] - Table name.
   * @param {number} index - Index value.
   * @returns {string} - SQL string.
   */
  _whereSQLFromHash(hash, modelClass, path, tableName, index = 0) {
    const options = this.getOptions()
    const modelQuery = /** @type {import("./model-class-query.js").default} */ (this.query)
    let sql = ""

    for (const whereKey in hash) {
      const whereValue = hash[whereKey]
      const relationship = this._getRelationship(modelClass, whereKey)

      if (relationship && this._isRelationshipWhereOperatorTupleContainer(whereValue)) {
        if (index > 0) sql += " AND "

        const targetModelClass = relationship.getTargetModelClass()
        const nestedPath = path.concat([whereKey])
        const nestedTableName = modelQuery.getTableReferenceForJoin(...nestedPath)
        const tuples = this._normalizeRelationshipWhereOperatorTuples(whereValue)

        sql += this._whereSQLFromRelationshipWhereOperatorTuples({
          modelClass: targetModelClass,
          tableName: nestedTableName,
          tuples
        })
      } else if (Array.isArray(whereValue) && whereValue.length === 0) {
        if (index > 0) sql += " AND "
        sql += "1=0"
      } else if (isPlainObject(whereValue)) {
        if (!relationship) {
          throw new Error(`Unknown relationship "${whereKey}" for ${modelClass.name}`)
        }

        const targetModelClass = relationship.getTargetModelClass()
        const nestedHash = /** @type {WhereHash} */ (whereValue)
        const nestedPath = path.concat([whereKey])
        const nestedTableName = modelQuery.getTableReferenceForJoin(...nestedPath)

        sql += this._whereSQLFromHash(nestedHash, targetModelClass, nestedPath, nestedTableName, index)
      } else {
        if (index > 0) sql += " AND "

        const columnName = this._resolveColumnName(modelClass, whereKey)

        if (!columnName) throw new Error(`Unknown attribute "${whereKey}" for ${modelClass.name}`)

        const columnType = modelClass.getColumnTypeByName(columnName)

        const normalizedValue = this._normalizeSqliteBooleanValue({
          columnName,
          modelClass,
          value: whereValue
        })
        const typedValue = this._normalizeValueForColumnType({
          columnName,
          modelClass,
          value: normalizedValue
        })

        if (typedValue === NO_MATCH) {
          sql += "1=0"
          index++
          continue
        }

        let columnSql = `${options.quoteColumnName(columnName)}`

        if (tableName) {
          columnSql = `${options.quoteTableName(tableName)}.${columnSql}`
        }

        const driverType = this.getQuery().driver.getType()

        if (driverType == "mssql" && typeof whereValue === "string" && columnType?.toLowerCase() == "text") {
          columnSql = `CAST(${columnSql} AS NVARCHAR(MAX))`
        }

        sql += columnSql

        if (Array.isArray(typedValue)) {
          sql += ` IN (${typedValue.map((value) => options.quote(value)).join(", ")})`
        } else if (typedValue === null) {
          sql += " IS NULL"
        } else {
          sql += ` = ${options.quote(typedValue)}`
        }
      }

      index++
    }

    return sql
  }
}
