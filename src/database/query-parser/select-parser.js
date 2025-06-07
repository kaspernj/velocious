import {digs} from "diggerize"

export default class VelociousDatabaseQueryParserSelectParser {
  constructor({pretty, query}) {
    this.pretty = pretty
    this.query = query
  }

  toSql() {
    const {pretty, query} = digs(this, "pretty", "query")

    let sql = ""

    sql += "SELECT"

    if (pretty) {
      sql += "\n"
    } else {
      sql += " "
    }

    for (const selectKey in query._selects) {
      const selectValue = query._selects[selectKey]

      sql += selectValue.toSql()

      if (selectKey + 1 < query._selects.length) {
        if (pretty) {
          sql += ","
          sql += "  "
        } else {
          sql += ", "
        }
      }
    }

    if (query._selects.length == 0) {
      if (query.modelClass) {
        sql += `${query.modelClass.connection().quoteTable(query.modelClass.tableName())}.*`
      } else {
        sql += "*"
      }
    }

    return sql
  }
}
