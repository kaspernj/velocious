// @ts-check

import AlterTableBase from "../../../query/alter-table-base.js"
import CreateIndexBase from "../../../query/create-index-base.js"
import {Logger} from "../../../../logger.js"
import restArgsError from "../../../../utils/rest-args-error.js"
import TableData from "../../../table-data/index.js"

export default class VelociousDatabaseConnectionDriversSqliteSqlAlterTable extends AlterTableBase {
  /**
   * @param {object} args
   * @param {import("../../base.js").default} args.driver
   * @param {import("../../../table-data/index.js").default} args.tableData
   */
  constructor({driver, tableData, ...restArgs}) {
    restArgsError(restArgs)

    if (!(tableData instanceof TableData)) throw new Error("Invalid table data was given")

    super({driver, tableData})
    this.logger = new Logger(this)
    this.tableData = tableData
  }

  /**
   * @returns {string[]}
   */
  async toSQLs() {
    const {tableData} = this
    const table = await this.getDriver().getTableByName(tableData.getName())

    if (!table) throw new Error(`Table ${tableData.getName()} does not exist`)

    const currentTableData = await table.getTableData()
    const options = this.getOptions()
    const tableName = tableData.getName()
    const tempTableName = `${tableData.getName()}AlterTableTemp`
    const newColumnNames = currentTableData.getColumns()
      .filter((column) => !column.isNewColumn())
      .map((column) => {
        const newTableColumn = tableData.getColumns().find((tableColumn) => tableColumn.getName() == column.getName())

        return newTableColumn?.getNewName() || newTableColumn?.getName() || column.getNewName() || column.getName()
      })
    const oldColumnNames = currentTableData.getColumns().filter((column) => !column.isNewColumn()).map((column) => column.getName())
    const newColumnsSQL = newColumnNames.map((name) => options.quoteColumnName(name)).join(", ")
    const oldColumnsSQL = oldColumnNames.map((name) => options.quoteColumnName(name)).join(", ")

    tableData.setName(tempTableName)

    const newTableData = new TableData(tempTableName)

    for (const tableDataColumn of currentTableData.getColumns()) {
      const newTableDataColumn = tableData.getColumns().find((newTableDataColumn) => newTableDataColumn.getName() == tableDataColumn.getName())

      if (newTableDataColumn) {
        newTableDataColumn.setAutoIncrement(tableDataColumn.getAutoIncrement())
        newTableDataColumn.setDefault(tableDataColumn.getDefault())
        newTableDataColumn.setIndex(tableDataColumn.getIndex())
        newTableDataColumn.setForeignKey(tableDataColumn.getForeignKey())
        newTableDataColumn.setMaxLength(tableDataColumn.getMaxLength())
        newTableDataColumn.setPrimaryKey(tableDataColumn.getPrimaryKey())
        newTableDataColumn.setType(tableDataColumn.getType())
      }

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

      this.logger.debug(() => [`Setting foreign key on column ${tableDataColumn.getName()}`])
      tableDataColumn.setForeignKey(actualTableDataForeignKey)
    }

    for (const foreignKey of tableData.getForeignKeys()) {
      if (foundForeignKeys.includes(foreignKey.getName())) continue

      // Register foreign key on the table
      newTableData.addForeignKey(foreignKey)

      // Register foreign key on the column
      const tableDataColumn = newTableData.getColumns().find((newTableDataColumn) => newTableDataColumn.getName() == foreignKey.getColumnName())

      if (!tableDataColumn) throw new Error(`Couldn't find column for foreign key: ${foreignKey.getName()}`)

      this.logger.debug(() => [`Setting foreign key on column ${tableDataColumn.getName()}`])
      tableDataColumn.setForeignKey(foreignKey)
    }

    const createNewTableSQL = this.getDriver().createTableSql(newTableData)
    const insertSQL = `INSERT INTO ${options.quoteTableName(tempTableName)} (${newColumnsSQL}) SELECT ${oldColumnsSQL} FROM ${options.quoteTableName(tableName)}`
    const dropTableSQLs = `DROP TABLE ${options.quoteTableName(tableName)}`
    const renameTableSQL = `ALTER TABLE ${options.quoteTableName(tempTableName)} RENAME TO ${options.quoteTableName(tableName)}`
    const sqls = []

    for (const sql of createNewTableSQL) {
      sqls.push(sql)
    }

    sqls.push(insertSQL)
    sqls.push(dropTableSQLs)
    sqls.push(renameTableSQL)

    for (const tableDataIndex of currentTableData.getIndexes()) {
      const newTableDataIndex = newTableData.getIndexes().find((newTableDataIndex) => newTableDataIndex.getName() == tableDataIndex.getName())
      const actualTableIndex = newTableDataIndex || tableDataIndex

      newTableData.addIndex(actualTableIndex)

      const columnNames = actualTableIndex.getColumns().map((columnName) => {
        const newTableColumn = tableData.getColumns().find((tableColumn) => tableColumn.getName() == columnName)

        return newTableColumn?.getNewName() || newTableColumn?.getName() || columnName
      })

      const createIndexArgs = {
        columns: columnNames,
        driver: this.getDriver(),
        name: actualTableIndex.getName(),
        tableName,
        unique: actualTableIndex.getUnique()
      }
      const createIndexSQLs = new CreateIndexBase(createIndexArgs).toSQLs()

      for (const createIndexSQL of createIndexSQLs) {
        sqls.push(createIndexSQL)
      }
    }

    return sqls
  }
}
