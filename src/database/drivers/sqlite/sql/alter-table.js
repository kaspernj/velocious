import AlterTableBase from "../../../query/alter-table-base.js"
import {digs} from "diggerize"
import restArgsError from "../../../../utils/rest-args-error.js"
import TableData from "../../../table-data/index.js"

export default class VelociousDatabaseConnectionDriversSqliteSqlAlterTable extends AlterTableBase {
  constructor({driver, tableData, ...restArgs}) {
    restArgsError(restArgs)

    if (!(tableData instanceof TableData)) throw new Error("Invalid table data was given")

    super({driver, tableData})
    this.tableData = tableData
  }

  toSqls() {
    const {tableData} = digs(this, "tableData")
    const options = this.getOptions()
    const tableName = tableData.getName()
    const tempTableName = `${tableData.getName()}AlterTableTemp`
    const oldColumnNames = tableData.getColumns().filter((column) => !column.isNewColumn()).map((column) => column.getName())
    const oldColumnsSQL = oldColumnNames.map((name) => options.quoteColumnName(name)).join(", ")

    tableData.setName(tempTableName)

    const createNewTableSQL = this.getDriver().createTableSql(tableData)
    const insertSQL = `INSERT INTO ${options.quoteTableName(tempTableName)} (${oldColumnsSQL}) SELECT ${oldColumnsSQL} FROM ${options.quoteTableName(tableName)}`
    const dropTableSQL = `DROP TABLE ${options.quoteTableName(tableName)}`
    const renameTableSQL = `ALTER TABLE ${options.quoteTableName(tempTableName)} RENAME TO ${options.quoteTableName(tableName)}`
    const sqls = []

    for (const sql of createNewTableSQL) {
      sqls.push(sql)
    }

    sqls.push(insertSQL)
    sqls.push(dropTableSQL)
    sqls.push(renameTableSQL)

    return sqls
  }
}
