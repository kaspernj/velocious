import {digs} from "diggerize"
import QueryBase from "./base.js"

export default class VelociousDatabaseQueryCreateIndexBase extends QueryBase {
  constructor({columns, driver, ifNotExists, name, unique, tableName}) {
    super({driver})
    this.columns = columns
    this.name = name
    this.tableName = tableName
    this.ifNotExists = ifNotExists
    this.unique = unique
  }

  generateIndexName() {
    let indexName = `index_on_${this.tableName}_`

    for (const columnIndex in this.columns) {
      if (columnIndex > 0) indexName += "_and_"

      indexName += this.columns[columnIndex]
    }

    return indexName
  }

  toSql() {
    const {tableName} = this
    const {columnQuote, indexQuote, tableQuote} = digs(this.getOptions(), "columnQuote", "indexQuote", "tableQuote")
    let sql = "CREATE"

    if (this.unique) sql += " UNIQUE"

    sql += " INDEX"

    if (this.ifNotExists) sql += " IF NOT EXISTS"

    sql += ` ${indexQuote}${this.name || this.generateIndexName()}${indexQuote}`
    sql += ` ON ${tableQuote}${tableName}${tableQuote} (`

    for (const columnIndex in this.columns) {
      if (columnIndex > 0) sql += ", "

      sql += `${columnQuote}${this.columns[columnIndex]}${columnQuote}`
    }

    sql += ")"

    return sql
  }
}
