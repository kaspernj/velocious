// @ts-check

import QueryBase from "./base.js"

/**
 * @typedef {object} CreateIndexBaseArgsType
 * @property {Array<string | import("./../table-data/table-column.js").default>} columns - Columns to include in the index.
 * @property {import("../drivers/base.js").default} driver - Database driver used to generate SQL.
 * @property {boolean} [ifNotExists] - Skip creation if the index already exists.
 * @property {string} [name] - Explicit index name to use.
 * @property {boolean} [unique] - Whether the index should enforce uniqueness.
 * @property {string} tableName - Name of the table to add the index to.
 */

export default class VelociousDatabaseQueryCreateIndexBase extends QueryBase {
  /**
   * @param {CreateIndexBaseArgsType} args
   */
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
    let columnCount = 0

    if (databaseType == "sqlite") indexName += `${this.tableName}_`

    for (const column of this.columns) {
      columnCount++

      if (columnCount > 1) indexName += "_and_"

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
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  async toSQLs() {
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

    let columnCount = 0

    for (const column of this.columns) {
      columnCount++

      if (columnCount > 1) sql += ", "

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

    return [sql]
  }
}
