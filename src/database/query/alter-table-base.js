// @ts-check

import QueryBase from "./base.js"
import restArgsError from "../../utils/rest-args-error.js"
import TableData from "../table-data/index.js"

export default class VelociousDatabaseQueryAlterTableBase extends QueryBase {
  /**
   * Runs constructor.
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
   * Runs to sqls.
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  async toSQLs() {
    const databaseType = this.getDriver().getType()
    const sqls = []
    const {tableData} = this
    const options = this.getOptions()

    let sql = `ALTER TABLE ${options.quoteTableName(tableData.getName())} `
    let actionCount = 0

    for (const column of tableData.getColumns()) {
      if (actionCount > 0) sql += ", "

      if (column.isNewColumn()) {
        sql += databaseType == "mssql" ? "ADD " : "ADD COLUMN "
        sql += column.getSQL({driver: this.getDriver(), forAlterTable: false})
      } else if (column.getNewName()) {
        const newColumnName = column.getNewName()

        if (!newColumnName) throw new Error(`Expected new column name for ${column.getName()}`)

        sql += `RENAME COLUMN ${options.quoteColumnName(column.getName())} TO ${options.quoteColumnName(newColumnName)}`
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


      actionCount++
    }

    // SQLite's ALTER TABLE does not support adding constraints; the SQLite driver overrides
    // alterTableSQLs entirely (via TableRebuilder) so this base path is never invoked there.
    for (const foreignKey of tableData.getForeignKeys()) {
      if (!foreignKey.getIsNewForeignKey() && !foreignKey.getDropForeignKey()) continue

      if (actionCount > 0) sql += ", "

      if (foreignKey.getDropForeignKey()) {
        sql += this.getDropForeignKeySQL(foreignKey)
        actionCount++
        continue
      }

      sql += "ADD"

      if (foreignKey.getName()) {
        sql += ` CONSTRAINT ${options.quoteIndexName(foreignKey.getName())}`
      }

      sql += ` FOREIGN KEY (${options.quoteColumnName(foreignKey.getColumnName())})`
      sql += ` REFERENCES ${options.quoteTableName(foreignKey.getReferencedTableName())} (${options.quoteColumnName(foreignKey.getReferencedColumnName())})`

      actionCount++
    }

    if (actionCount > 0) {
      sqls.push(sql)
    }

    if (databaseType == "pgsql") {
      for (const column of tableData.getColumns()) {
      if (!column.isNewColumn() || column.getDropColumn()) continue

      const notes = column.getNotesForDatabase(databaseType)
      const actualName = column.getActualName()

      if (!notes || !actualName) continue

      sqls.push(
        `COMMENT ON COLUMN ${options.quoteTableName(tableData.getName())}.${options.quoteColumnName(actualName)} IS ${options.quote(notes)}`
      )
      }
    }

    return sqls
  }

  /**
   * Runs get drop foreign key sql.
   * @param {import("../table-data/table-foreign-key.js").default} foreignKey - Foreign key to drop.
   * @returns {string} - SQL fragment that removes the foreign key.
   */
  getDropForeignKeySQL(foreignKey) {
    const name = foreignKey.getName()

    if (!name) throw new Error(`Cannot remove unnamed foreign key on ${foreignKey.getTableName()}.${foreignKey.getColumnName()}`)

    return `DROP CONSTRAINT ${this.getOptions().quoteIndexName(name)}`
  }
}
