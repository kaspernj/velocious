import AlterTableBase from "../../../query/alter-table-base.js"
import CreateIndexBase from "../../../query/create-index-base.js"
import {digs} from "diggerize"
import {Logger} from "../../../../logger.js"
import restArgsError from "../../../../utils/rest-args-error.js"
import TableData from "../../../table-data/index.js"

export default class VelociousDatabaseConnectionDriversSqliteSqlAlterTable extends AlterTableBase {
  constructor({driver, tableData, ...restArgs}) {
    restArgsError(restArgs)

    if (!(tableData instanceof TableData)) throw new Error("Invalid table data was given")

    super({driver, tableData})
    this.logger = new Logger(this)
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

    for (const tableDataColumn of tableData.getColumns()) {
      if (!tableDataColumn.isNewColumn()) continue

      newTableData.addColumn(tableDataColumn)
    }

    const foundForeignKeys = []

    for (const tableDataForeignKey of currentTableData.getForeignKeys()) {
      const newTableDataForeignKey = newTableData.getForeignKeys().find((newTableDataForeignKey) => newTableDataForeignKey.getName() == tableDataForeignKey.getName())

      if (newTableDataForeignKey) foundForeignKeys.push(newTableDataForeignKey.getName())

      const actualTableDataForeignKey = newTableDataForeignKey || tableDataForeignKey

      // Register foreign key on the table
      newTableData.addForeignKey(actualTableDataForeignKey)

      // Register foreign key on the column
      const tableDataColumn = newTableData.getColumns().find((newTableDataColumn) => newTableDataColumn.getName() == actualTableDataForeignKey.getColumnName())

      if (!tableDataColumn) throw new Error(`Couldn't find column for foreign key: ${actualTableDataForeignKey.getName()}`)

      this.logger.log(`Setting foreign key on column ${tableDataColumn.getName()}`)
      tableDataColumn.setForeignKey(actualTableDataForeignKey)
    }

    for (const foreignKey of tableData.getForeignKeys()) {
      if (foundForeignKeys.includes(foreignKey.getName())) continue

      // Register foreign key on the table
      newTableData.addForeignKey(foreignKey)

      // Register foreign key on the column
      const tableDataColumn = newTableData.getColumns().find((newTableDataColumn) => newTableDataColumn.getName() == foreignKey.getColumnName())

      if (!tableDataColumn) throw new Error(`Couldn't find column for foreign key: ${actualTableDataForeignKey.getName()}`)

      this.logger.log(`Setting foreign key on column ${tableDataColumn.getName()}`)
      tableDataColumn.setForeignKey(actualTableDataForeignKey)
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

    return sqls
  }
}
