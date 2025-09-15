import AlterTableBase from "../../../query/alter-table-base.js"
import CreateIndexBase from "../../../query/create-index-base.js"
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

  async toSqls() {
    const {tableData} = digs(this, "tableData")
    const table = await this.getDriver().getTableByName(tableData.getName())
    const currentTableData = await table.getTableData()
    const options = this.getOptions()
    const tableName = tableData.getName()
    const tempTableName = `${tableData.getName()}AlterTableTemp`
    const oldColumnNames = currentTableData.getColumns().filter((column) => !column.isNewColumn()).map((column) => column.getName())
    const oldColumnsSQL = oldColumnNames.map((name) => options.quoteColumnName(name)).join(", ")

    tableData.setName(tempTableName)

    const newTableData = new TableData(tempTableName)

    for (const tableDataColumn of currentTableData.getColumns()) {
      const newTableDataColumn = newTableData.getColumns().find((newTableDataColumn) => newTableDataColumn.getName() == tableDataColumn.getName())

      newTableData.addColumn(newTableDataColumn || tableDataColumn)
    }

    const createNewTableSQL = this.getDriver().createTableSql(newTableData)
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

    for (const tableDataIndex of currentTableData.getIndexes()) {
      const newTableDataIndex = newTableData.getIndexes().find((newTableDataIndex) => newTableDataIndex.getName() == tableDataIndex.getName())
      const actualTableIndex = newTableDataIndex || tableDataIndex

      newTableData.addIndex(actualTableIndex)

      console.log({actualTableIndex})

      const createIndexArgs = {
        columns: actualTableIndex.getColumns(),
        driver: this.getDriver(),
        name: actualTableIndex.getName(),
        tableName,
        unique: actualTableIndex.getUnique()
      }
      const sql = new CreateIndexBase(createIndexArgs).toSql()

      sqls.push(sql)
    }

    console.log({sqls})

    return sqls
  }
}
