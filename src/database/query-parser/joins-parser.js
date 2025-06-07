import {digs} from "diggerize"
import JoinPlain from "../query/join-plain.js"

export default class VelocuiousDatabaseQueryParserJoinsParser {
  constructor({pretty, query}) {
    this.pretty = pretty
    this.query = query
    this.conn = this.query.driver
  }

  toSql() {
    const {pretty, query} = digs(this, "pretty", "query")
    let sql = ""

    for (const joinKey in query._joins) {
      const join = query._joins[joinKey]

      if (join instanceof JoinPlain) {
        if (joinKey == 0) {
          if (pretty) {
            sql += "\n\n"
          } else {
            sql += " "
          }
        }

        sql += join.toSql()
      } else if (typeof join == "object") {
        sql = this.joinObject({join, modelClass: query.modelClass, sql})
      } else {
        throw new Error(`Unknown join object: ${join.constructor.name}`)
      }
    }

    return sql
  }

  joinObject({join, modelClass, sql}) {
    const {conn, pretty} = this

    for (const joinKey in join) {
      const joinValue = join[joinKey]
      const relationship = modelClass.getRelationshipByName(joinKey)
      const targetModelClass = relationship.getTargetModelClass()

      if (pretty) {
        sql += "\n\n"
      } else {
        sql += " "
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
        sql = this.joinObject({join: joinValue, modelClass: targetModelClass, sql})
      }
    }

    return sql
  }
}
