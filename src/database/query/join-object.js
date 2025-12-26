// @ts-check

import JoinBase from "./join-base.js"

/**
 * @typedef {{[key: string]: boolean | JoinObject}} JoinObject
 */

export default class VelociousDatabaseQueryJoinObject extends JoinBase {
  /**
   * @param {JoinObject} object
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

    return this.joinObject(this.object, ModelClass, "", 0)
  }

  /**
   * @param {JoinObject} join
   * @param {typeof import("../record/index.js").default} modelClass
   * @param {string} sql
   * @param {number} joinsCount
   * @returns {string} - The join object.
   */
  joinObject(join, modelClass, sql, joinsCount) {
    const pretty = this.pretty
    const conn = this.getQuery().driver

    for (const joinKey in join) {
      const joinValue = join[joinKey]
      const relationship = modelClass.getRelationshipByName(joinKey)
      const targetModelClass = relationship.getTargetModelClass()

      if (joinsCount > 0) {
        if (pretty) {
          sql += "\n\n"
        } else {
          sql += " "
        }
      }

      sql += `LEFT JOIN ${conn.quoteTable(targetModelClass.tableName())} ON `

      if (relationship.getType() == "belongsTo") {
        sql += `${conn.quoteTable(targetModelClass.tableName())}.${conn.quoteColumn(relationship.getPrimaryKey())} = `
        sql += `${conn.quoteTable(modelClass.tableName())}.${conn.quoteColumn(relationship.getForeignKey())}`
      } else if (relationship.getType() == "hasMany" || relationship.getType() == "hasOne") {
        sql += `${conn.quoteTable(targetModelClass.tableName())}.${conn.quoteColumn(relationship.getForeignKey())} = `
        sql += `${conn.quoteTable(modelClass.tableName())}.${conn.quoteColumn(relationship.getPrimaryKey())}`
      } else {
        throw new Error(`Unknown relationship type: ${relationship.getType()}`)
      }

      if (typeof joinValue == "object") {
        sql = this.joinObject(joinValue, targetModelClass, sql, joinsCount + 1)
      }
    }

    return sql
  }
}
