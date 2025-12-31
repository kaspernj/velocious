// @ts-check

import JoinBase from "./join-base.js"
import WhereHash from "./where-hash.js"

/**
 * @typedef {{[key: string]: boolean | JoinObject}} JoinObject
 */

export default class VelociousDatabaseQueryJoinObject extends JoinBase {
  /**
   * @param {JoinObject} object - Object.
   */
  constructor(object) {
    super()
    this.object = object
  }

  toSql() {
    const query = this.getQuery()

    if (query.constructor.name != "VelociousDatabaseQueryModelClassQuery") {
      throw new Error(`Query has to be a ModelClassQuery but was a ${query.constructor.name}`)
    }

    // @ts-expect-error
    const ModelClass = /** @type {typeof import("../record/index.js").default} */ (query.modelClass)

    const modelQuery = /** @type {import("./model-class-query.js").default} */ (query)

    return this.joinObject(this.object, ModelClass, "", 0, modelQuery.getJoinBasePath())
  }

  /**
   * @param {JoinObject} join - Join.
   * @param {typeof import("../record/index.js").default} modelClass - Model class.
   * @param {string} sql - SQL string.
   * @param {number} joinsCount - Joins count.
   * @param {string[]} path - Join path.
   * @returns {string} - The join object.
   */
  joinObject(join, modelClass, sql, joinsCount, path) {
    const pretty = this.pretty
    const conn = this.getQuery().driver
    const query = /** @type {import("./model-class-query.js").default} */ (this.getQuery())

    for (const joinKey in join) {
      const joinValue = join[joinKey]
      const relationship = modelClass.getRelationshipByName(joinKey)
      const targetModelClass = relationship.getTargetModelClass()
      const joinPath = path.concat([joinKey])
      const parentTableRef = query.getJoinTableReference(path)
      const targetEntry = query._registerJoinPath(joinPath)
      const targetTableRef = targetEntry.alias || targetEntry.tableName
      const joinTableSql = targetEntry.alias
        ? `${conn.quoteTable(targetEntry.tableName)} AS ${conn.quoteTable(targetEntry.alias)}`
        : conn.quoteTable(targetEntry.tableName)

      if (joinsCount > 0) {
        if (pretty) {
          sql += "\n\n"
        } else {
          sql += " "
        }
      }

      sql += `LEFT JOIN ${joinTableSql} ON `

      if (relationship.getType() == "belongsTo") {
        sql += `${conn.quoteTable(targetTableRef)}.${conn.quoteColumn(relationship.getPrimaryKey())} = `
        sql += `${conn.quoteTable(parentTableRef)}.${conn.quoteColumn(relationship.getForeignKey())}`
      } else if (relationship.getType() == "hasMany" || relationship.getType() == "hasOne") {
        sql += `${conn.quoteTable(targetTableRef)}.${conn.quoteColumn(relationship.getForeignKey())} = `
        sql += `${conn.quoteTable(parentTableRef)}.${conn.quoteColumn(relationship.getPrimaryKey())}`
      } else {
        throw new Error(`Unknown relationship type: ${relationship.getType()}`)
      }

      const scopeSql = this._scopeSql({relationship, query, targetModelClass, joinPath, targetTableRef})

      if (scopeSql) {
        sql += ` AND ${scopeSql}`
      }

      if (typeof joinValue == "object") {
        sql = this.joinObject(joinValue, targetModelClass, sql, joinsCount + 1, joinPath)
      }
    }

    return sql
  }

  /**
   * @param {object} args - Options object.
   * @param {import("../record/relationships/base.js").default} args.relationship - Relationship definition.
   * @param {import("./model-class-query.js").default} args.query - Model class query.
   * @param {typeof import("../record/index.js").default} args.targetModelClass - Target model class.
   * @param {string[]} args.joinPath - Join path.
   * @param {string} args.targetTableRef - Target table reference.
   * @returns {string} - Scope SQL.
   */
  _scopeSql({relationship, query, targetModelClass, joinPath, targetTableRef}) {
    if (!relationship.getScope()) return ""

    const scopedQuery = query.buildJoinScopeQuery(targetModelClass, joinPath)
    const appliedQuery = relationship.applyScope(scopedQuery) || scopedQuery
    const wheres = appliedQuery._wheres

    if (!wheres || wheres.length === 0) return ""

    const parts = []

    for (const where of wheres) {
      if (where instanceof WhereHash) {
        const hash = where.hash
        const hasNested = Object.values(hash).some((value) => value !== null && typeof value === "object" && !Array.isArray(value))
        const whereSql = hasNested
          ? where.toSql()
          : `(${where._whereSQLFromHash(hash, targetTableRef)})`

        parts.push(whereSql)
      } else {
        parts.push(where.toSql())
      }
    }

    return parts.join(" AND ")
  }
}
