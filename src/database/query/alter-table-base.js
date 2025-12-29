// @ts-check

import QueryBase from "./base.js"
import restArgsError from "../../utils/rest-args-error.js"
import TableData from "../table-data/index.js"

export default class VelociousDatabaseQueryAlterTableBase extends QueryBase {
  /**
   * @param {object} args - Options object.
   * @param {import("../drivers/base.js").default} args.driver - Database driver instance.
   * @param {TableData} args.tableData - Table data.
   */
  constructor({driver, tableData, ...restArgs}) {
    restArgsError(restArgs)

    if (!(tableData instanceof TableData)) throw new Error("Invalid table data was given")

    super({driver})
    this.tableData = tableData
  }

  /**
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  async toSQLs() {
    const databaseType = this.getDriver().getType()
    const sqls = []
    const {tableData} = this
    const options = this.getOptions()

    let sql = `ALTER TABLE ${options.quoteTableName(tableData.getName())} `
    let columnsCount = 0

    for (const column of tableData.getColumns()) {
      if (columnsCount > 0) sql += ", "

      if (column.isNewColumn()) {
        sql += "ADD "
        sql += column.getSQL({driver: this.getDriver(), forAlterTable: false})
      } else if (column.getNewName()) {
        sql += `RENAME COLUMN ${options.quoteColumnName(column.getName())} TO ${options.quoteColumnName(column.getNewName())}`
      } else if (column.getDropColumn()) {
        sql += `DROP COLUMN ${options.quoteColumnName(column.getName())}`
      } else {
        if (databaseType == "mssql" || databaseType == "pgsql") {
          sql += "ALTER COLUMN "
        } else {
          sql += "MODIFY "
        }

        sql += column.getSQL({driver: this.getDriver(), forAlterTable: true})
      }


      columnsCount++
    }

    sqls.push(sql)

    if (databaseType == "pgsql") {
      for (const column of tableData.getColumns()) {
        if (!column.isNewColumn() || column.getDropColumn()) continue

        const notes = column.getNotesForDatabase(databaseType)

        if (!notes) continue

        sqls.push(
          `COMMENT ON COLUMN ${options.quoteTableName(tableData.getName())}.${options.quoteColumnName(column.getActualName())} IS ${options.quote(notes)}`
        )
      }
    }

    return sqls
  }
}
