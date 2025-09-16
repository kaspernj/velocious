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
    const databaseType = this.getDriver().getType()
    let indexName = `index_on_`

    if (databaseType == "sqlite") indexName += `${this.tableName}_`

    for (const columnIndex in this.columns) {
      if (columnIndex > 0) indexName += "_and_"

      const column = this.columns[columnIndex]
      let columnName

      if (typeof column == "string") {
        columnName = column
      } else {
        columnName = column.getName()
      }

      indexName += columnName
    }

    return indexName
  }

  toSql() {
    const options = this.getOptions()
    const {tableName} = this
    let sql = "CREATE"

    if (this.unique) sql += " UNIQUE"

    sql += " INDEX"

    if (this.ifNotExists) sql += " IF NOT EXISTS"

    sql += ` ${options.quoteIndexName(this.name || this.generateIndexName())}`
    sql += ` ON ${options.quoteTableName(tableName)} (`

    for (const columnIndex in this.columns) {
      if (columnIndex > 0) sql += ", "

      const column = this.columns[columnIndex]
      let columnName

      if (typeof column == "string") {
        columnName = column
      } else {
        columnName = column.getName()
      }

      sql += `${options.quoteColumnName(columnName)}`
    }

    sql += ")"

    return sql
  }
}
