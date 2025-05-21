import Base from "../base.mjs"
import CreateTable from "../sqlite/sql/create-table.mjs"
import Delete from "../sqlite/sql/delete.mjs"
import Insert from "../sqlite/sql/insert.mjs"
import QueryParser from "../sqlite/query-parser.mjs"
import Table from "./table"
import Update from "../sqlite/sql/update.mjs"

export default class VelociousDatabaseDriversSqliteBase extends Base {
  createTableSql(tableData) {
    const createArgs = Object.assign({tableData, driver: this})
    const createTable = new CreateTable(createArgs)

    return createTable.toSql()
  }

  deleteSql = ({tableName, conditions}) => new Delete({conditions, driver: this, tableName}).toSql()
  insertSql = ({tableName, data}) => new Insert({driver: this, tableName, data}).toSql()

  async getTables() {
    const result = await this.query("SELECT name FROM sqlite_master WHERE type = 'table'")
    const tables = []

    for (const row of result) {
      const table = new Table(row)

      tables.push(table)
    }

    return tables
  }

  queryToSql = (query) => new QueryParser({query}).toSql()
  quoteColumn = (string) => `\`${string}\``
  updateSql = ({conditions, data, tableName}) => new Update({conditions, data, driver: this, tableName}).toSql()
}
