import {digs} from "diggerize"
import QueryBase from "./base.js"
import restArgsError from "../../utils/rest-args-error.js"
import TableData from "../table-data/index.js"

export default class VelociousDatabaseQueryAlterTableBase extends QueryBase {
  constructor({driver, tableData, ...restArgs}) {
    restArgsError(restArgs)

    if (!(tableData instanceof TableData)) throw new Error("Invalid table data was given")

    super({driver})
    this.tableData = tableData
  }

  toSqls() {
    const databaseType = this.getDriver().getType()
    const sqls = []
    const {tableData} = digs(this, "tableData")
    const options = this.getOptions()

    let sql = `ALTER TABLE ${options.quoteTableName(tableData.getName())} `
    let columnsCount = 0

    for (const column of tableData.getColumns()) {
      if (columnsCount > 0) sql += ", "

      if (column.isNewColumn()) {
        sql += "ADD "
      } else {
        if (databaseType == "pgsql") {
          sql += "ALTER COLUMN "
        } else {
          sql += "MODIFY "
        }
      }

      sql += column.getSQL({driver: this.getDriver(), forAlterTable: true})
      columnsCount++
    }

    sqls.push(sql)

    return sqls
  }
}
