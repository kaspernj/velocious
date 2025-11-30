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

  /**
   * @returns {string}
   */
  toSql() {
    const databaseType = this.getDriver().getType()
    const indexName = this.name || this.generateIndexName()
    const options = this.getOptions()
    const {tableName} = this
    let sql = ""

    if (this.ifNotExists && databaseType == "mssql") {
      sql += `
        IF NOT EXISTS (
          SELECT 1
          FROM sys.indexes
          WHERE
            name = ${options.quote(indexName)} AND
            object_id = OBJECT_ID(${options.quote(`dbo.${tableName}`)})
        )
        BEGIN
      `
    }

    sql += "CREATE"

    if (this.unique) sql += " UNIQUE"

    sql += " INDEX"

    if (this.ifNotExists && databaseType != "mssql") sql += " IF NOT EXISTS"

    sql += ` ${options.quoteIndexName(indexName)}`
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

    if (this.ifNotExists && databaseType == "mssql") {
      sql += " END"
    }

    return sql
  }
}
