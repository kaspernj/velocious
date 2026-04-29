// @ts-check

import AlterTableBase from "../../../query/alter-table-base.js"
import Logger from "../../../../logger.js"
import restArgsError from "../../../../utils/rest-args-error.js"
import TableData from "../../../table-data/index.js"
import TableIndex from "../../../table-data/table-index.js"
import TableRebuilder from "../table-rebuilder.js"

export default class VelociousDatabaseConnectionDriversSqliteSqlAlterTable extends AlterTableBase {
  /**
   * @param {object} args - Options object.
   * @param {import("../../base.js").default} args.driver - Database driver instance.
   * @param {import("../../../table-data/index.js").default} args.tableData - Table data.
   */
  constructor({driver, tableData, ...restArgs}) {
    restArgsError(restArgs)

    if (!(tableData instanceof TableData)) throw new Error("Invalid table data was given")

    super({driver, tableData})
    this.logger = new Logger(this)
    this.tableData = tableData
  }

  /**
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  async toSQLs() {
    const driver = this.getDriver()
    const {tableData: alterTableData} = this
    const tableName = alterTableData.getName()
    const table = await driver.getTableByName(tableName)

    if (!table) throw new Error(`Table ${tableName} does not exist`)

    const currentTableData = await table.getTableData()
    const {targetTableData, columnPairs} = this._buildTargetSchema(currentTableData, alterTableData)

    const rebuilder = new TableRebuilder({
      columnPairs,
      driver,
      originalTableName: tableName,
      targetTableData
    })

    const rebuildSQLs = await rebuilder.toSQLs()
    const sqls = []

    // PRAGMA foreign_keys can only be toggled outside an active transaction; when the
    // caller is already inside one these become no-ops (matching prior behavior). Outside
    // a transaction they protect the rebuild from cross-table FK enforcement during the
    // DROP/RENAME swap.
    sqls.push("PRAGMA foreign_keys = OFF")

    for (const sql of rebuildSQLs) sqls.push(sql)

    sqls.push("PRAGMA foreign_keys = ON")

    return sqls
  }

  /**
   * Merges the current schema with the alter request to produce the desired final schema
   * and the column copy plan.
   * @param {TableData} currentTableData - Current schema as introspected from the database.
   * @param {TableData} alterTableData - Alter request: new columns (`isNewColumn`), renames (`newName`), drops (`dropColumn`), modifies, and new foreign keys.
   * @returns {{targetTableData: TableData, columnPairs: Array<[string, string]>}} - The merged target schema and the [oldName, newName] pairs for INSERT...SELECT.
   */
  _buildTargetSchema(currentTableData, alterTableData) {
    const targetTableData = new TableData(currentTableData.getName())
    /** @type {Array<[string, string]>} */
    const columnPairs = []
    const alterColumns = alterTableData.getColumns()
    const existingNames = new Set(currentTableData.getColumns().map((column) => column.getName()))

    for (const currentColumn of currentTableData.getColumns()) {
      const alterColumn = alterColumns.find((column) => column.getName() == currentColumn.getName() && !column.isNewColumn())

      if (alterColumn?.getDropColumn()) continue

      let targetColumn

      if (alterColumn) {
        // The alter request supplies a partial column spec (e.g. just a rename or a type change);
        // inherit unset properties from the current column so we don't lose existing definitions.
        alterColumn.setAutoIncrement(alterColumn.getAutoIncrement() || currentColumn.getAutoIncrement())
        if (alterColumn.getDefault() === undefined) alterColumn.setDefault(currentColumn.getDefault())
        if (!alterColumn.getIndex()) alterColumn.setIndex(currentColumn.getIndex())
        if (!alterColumn.getForeignKey()) alterColumn.setForeignKey(currentColumn.getForeignKey())
        if (alterColumn.getMaxLength() === undefined) alterColumn.setMaxLength(currentColumn.getMaxLength())
        alterColumn.setPrimaryKey(alterColumn.getPrimaryKey() || currentColumn.getPrimaryKey())
        if (!alterColumn.getType()) alterColumn.setType(currentColumn.getType())

        targetColumn = alterColumn
      } else {
        targetColumn = currentColumn
      }

      targetTableData.addColumn(targetColumn)
      columnPairs.push([currentColumn.getName(), targetColumn.getNewName() || targetColumn.getName()])
    }

    for (const alterColumn of alterColumns) {
      if (!alterColumn.isNewColumn()) continue
      if (existingNames.has(alterColumn.getName())) continue

      targetTableData.addColumn(alterColumn)
    }

    const seenForeignKeyNames = new Set()

    for (const currentForeignKey of currentTableData.getForeignKeys()) {
      const alterForeignKey = alterTableData.getForeignKeys().find((foreignKey) => foreignKey.getName() == currentForeignKey.getName())
      const finalForeignKey = alterForeignKey || currentForeignKey

      seenForeignKeyNames.add(finalForeignKey.getName())
      targetTableData.addForeignKey(finalForeignKey)
    }

    for (const alterForeignKey of alterTableData.getForeignKeys()) {
      if (seenForeignKeyNames.has(alterForeignKey.getName())) continue

      targetTableData.addForeignKey(alterForeignKey)
    }

    for (const currentIndex of currentTableData.getIndexes()) {
      const renamedColumns = currentIndex.getColumns().map((columnName) => {
        if (typeof columnName != "string") return columnName

        const renamingAlterColumn = alterColumns.find((column) => column.getName() == columnName && !column.isNewColumn() && column.getNewName())

        return renamingAlterColumn?.getNewName() || columnName
      })

      targetTableData.addIndex(new TableIndex(renamedColumns, {
        name: currentIndex.getName(),
        unique: currentIndex.getUnique()
      }))
    }

    return {targetTableData, columnPairs}
  }
}
