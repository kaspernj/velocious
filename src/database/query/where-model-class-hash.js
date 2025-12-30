// @ts-check

import {isPlainObject} from "is-plain-object"
import WhereBase from "./where-base.js"

/**
 * @typedef {{[key: string]: string | number | boolean | null | Array<string | number | boolean | null> | Record<string, any>}} WhereHash
 */

const NO_MATCH = Symbol("no-match")

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

    const baseTableName = this.qualifyBaseTable ? this.getModelClass().tableName() : undefined

    sql += this._whereSQLFromHash(this.hash, this.getModelClass(), baseTableName)
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
   * @param {string} [tableName] - Table name.
   * @param {number} index - Index value.
   * @returns {string} - SQL string.
   */
  _whereSQLFromHash(hash, modelClass, tableName, index = 0) {
    const options = this.getOptions()
    let sql = ""

    for (const whereKey in hash) {
      const whereValue = hash[whereKey]

      if (Array.isArray(whereValue) && whereValue.length === 0) {
        if (index > 0) sql += " AND "
        sql += "1=0"
      } else if (isPlainObject(whereValue)) {
        const relationship = this._getRelationship(modelClass, whereKey)

        if (!relationship) {
          throw new Error(`Unknown relationship "${whereKey}" for ${modelClass.name}`)
        }

        const targetModelClass = relationship.getTargetModelClass()
        const nestedHash = /** @type {WhereHash} */ (whereValue)

        sql += this._whereSQLFromHash(nestedHash, targetModelClass, targetModelClass.tableName(), index)
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
