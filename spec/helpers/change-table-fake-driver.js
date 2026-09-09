// @ts-check

import Base from "../../src/database/drivers/base.js"
import MssqlDriver from "../../src/database/drivers/mssql/index.js"
import MssqlOptions from "../../src/database/drivers/mssql/options.js"
import MysqlDriver from "../../src/database/drivers/mysql/index.js"
import MysqlOptions from "../../src/database/drivers/mysql/options.js"
import PgsqlDriver from "../../src/database/drivers/pgsql/index.js"
import PgsqlOptions from "../../src/database/drivers/pgsql/options.js"
import SqliteOptions from "../../src/database/drivers/sqlite/options.js"

/**
 * Fake column returned from {@link ChangeTableFakeTable}.
 */
class ChangeTableFakeColumn {
  /**
   * @param {object} args - Options.
   * @param {ChangeTableFakeDriver} args.driver - Driver instance.
   * @param {string} args.name - Column name.
   * @param {string} args.tableName - Table name.
   */
  constructor({driver, name, tableName}) {
    this._driver = driver
    this._name = name
    this._tableName = tableName
  }

  /**
   * Records a change-nullability operation through the fake driver.
   * @param {boolean} nullable - Whether the column becomes nullable.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async changeNullable(nullable) {
    await this._driver.query(`CHANGE NULL ${this._tableName}.${this._name} NULLABLE=${nullable}`)
  }
}

/**
 * Fake table metadata used by migration helpers that introspect tables.
 */
class ChangeTableFakeTable {
  /**
   * @param {object} args - Options.
   * @param {ChangeTableFakeDriver} args.driver - Driver instance.
   * @param {string} args.name - Table name.
   */
  constructor({driver, name}) {
    this._driver = driver
    this._name = name
    /**
     * @type {Map<string, ChangeTableFakeColumn>} */
    this._columns = new Map()
  }

  getName() { return this._name }

  /**
   * Registers a column on the fake table.
   * @param {string} columnName - Column name.
   * @returns {void} - No return value.
   */
  setColumn(columnName) {
    this._columns.set(columnName, new ChangeTableFakeColumn({driver: this._driver, name: columnName, tableName: this._name}))
  }

  /**
   * @param {string} columnName - Column name.
   * @returns {Promise<ChangeTableFakeColumn | undefined>} - The column or undefined.
   */
  async getColumnByName(columnName) {
    return this._columns.get(columnName)
  }

  /**
   * @returns {Promise<Array<{getColumnName: () => string}>>} - No foreign keys.
   */
  async getForeignKeys() {
    return []
  }

  /**
   * @returns {Promise<Array<{getName: () => string, getColumnNames: () => string[]}>>} - No indexes.
   */
  async getIndexes() {
    return []
  }
}

/**
 * Fake driver that records queries and defers SQL generation to the real
 * per-driver classes where they work without a live connection. Used by the
 * changeTable unit specs to assert exact SQL and command ordering.
 */
export default class ChangeTableFakeDriver extends Base {
  /**
   * Queries.
   * @type {string[]} */
  queries = []

  /**
   * Table data passed to alterTableSQLs.
   * @type {Array<import("../../src/database/table-data/index.js").default>} */
  alterCalls = []

  /**
   * Index data passed to createIndexSQLs.
   * @type {Array<import("../../src/database/drivers/base.js").CreateIndexSqlArgs>} */
  indexCalls = []

  /**
   * Index data passed to removeIndexSQLs.
   * @type {Array<import("../../src/database/drivers/base.js").RemoveIndexSqlArgs>} */
  removeIndexCalls = []

  /**
   * Real driver used for SQL generation.
   * @type {MysqlDriver | PgsqlDriver | MssqlDriver | undefined} */
  _realDriver = undefined

  /**
   * @param {object} args - Options.
   * @param {"sqlite" | "mysql" | "pgsql" | "mssql"} args.type - Fake database type.
   * @param {boolean} [args.bulkAlter] - Override whether bulk alter is supported.
   * @param {boolean} [args.bulkAlterIndexes] - Override whether indexes join a bulk alter.
   */
  constructor({type, bulkAlter, bulkAlterIndexes}) {
    super({type})

    /**
     * Tables.
     * @type {Map<string, ChangeTableFakeTable>} */
    this._tables = new Map()
    this._type = type

    /**
     * Explicit capability overrides so specs can prove fallback and batching
     * decisions are capability-driven rather than type-name-driven.
     * @type {boolean | undefined} */
    this._bulkAlterOverride = bulkAlter

    /**
     * Explicit capability override.
     * @type {boolean | undefined} */
    this._bulkAlterIndexesOverride = bulkAlterIndexes

    if (type == "mysql") {
      this._realDriver = new MysqlDriver({type: "mysql"})
    } else if (type == "pgsql") {
      this._realDriver = new PgsqlDriver({type: "pgsql"})
    } else if (type == "mssql") {
      this._realDriver = new MssqlDriver({sqlConfig: {}})
    }
  }

  getType() { return this._type }

  /**
   * Whether the fake driver supports bulk alters. Defaults to the real driver
   * capability when one backs the fake type, and honors explicit overrides.
   * @returns {boolean} - Whether bulk alter is supported.
   */
  // fallow-ignore-next-line unused-class-member -- consumed through Migration#getDriver's base-typed boundary
  supportsBulkAlter() {
    if (this._bulkAlterOverride != undefined) return this._bulkAlterOverride

    return this._realDriver ? this._realDriver.supportsBulkAlter() : false
  }

  /**
   * Whether the fake driver can carry `ADD INDEX` clauses inside a bulk alter.
   * @returns {boolean} - Whether indexes can be added inside a bulk alter.
   */
  // fallow-ignore-next-line unused-class-member -- consumed through Migration#getDriver's base-typed boundary
  supportsBulkAlterIndexes() {
    if (this._bulkAlterIndexesOverride != undefined) return this._bulkAlterIndexesOverride

    return this._realDriver ? this._realDriver.supportsBulkAlterIndexes() : false
  }

  options() {
    if (this._type == "mysql") return new MysqlOptions({driver: this})
    if (this._type == "pgsql") return new PgsqlOptions({driver: this})
    if (this._type == "mssql") return new MssqlOptions({driver: this})

    return new SqliteOptions(this)
  }

  /**
   * @param {string} tableName - Table name.
   * @returns {Promise<ChangeTableFakeTable | undefined>} - The table metadata.
   */
  async getTableByName(tableName) {
    return this._tables.get(tableName)
  }

  /**
   * Registers a fake table for introspection.
   * @param {string} tableName - Table name.
   * @returns {ChangeTableFakeTable} - The table metadata.
   */
  setTable(tableName) {
    const table = new ChangeTableFakeTable({driver: this, name: tableName})

    this._tables.set(tableName, table)

    return table
  }

  /**
   * Records queries and returns an empty result.
   * @param {string} sql - SQL string.
   * @returns {Promise<import("../../src/database/drivers/base.js").QueryResultType>} - Query result.
   */
  async query(sql) {
    this.queries.push(sql)

    return []
  }

  /**
   * Generates SQL for a TableData. MySQL, PostgreSQL and MSSQL defer to the
   * real driver SQL builders; SQLite returns a marker because its real
   * alter-table path requires live table introspection.
   * @param {import("../../src/database/table-data/index.js").default} tableData - Table data.
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  async alterTableSQLs(tableData) {
    this.alterCalls.push(tableData)

    if (this._realDriver) {
      return await this._realDriver.alterTableSQLs(tableData)
    }

    const sqls = []

    for (const column of tableData.getColumns()) {
      if (column.isNewColumn()) {
        sqls.push(`ALTER TABLE ${tableData.getName()} ADD COLUMN ${column.getName()}`)
      } else if (column.getNewName()) {
        sqls.push(`ALTER TABLE ${tableData.getName()} RENAME COLUMN ${column.getName()} TO ${column.getNewName()}`)
      } else if (column.getDropColumn()) {
        sqls.push(`ALTER TABLE ${tableData.getName()} DROP COLUMN ${column.getName()}`)
      } else {
        sqls.push(`ALTER TABLE ${tableData.getName()} MODIFY COLUMN ${column.getName()}`)
      }
    }

    for (const foreignKey of tableData.getForeignKeys()) {
      sqls.push(`ALTER TABLE ${tableData.getName()} ADD FOREIGN KEY ${foreignKey.getColumnName()}`)
    }

    return sqls
  }

  /**
   * @param {import("../../src/database/drivers/base.js").CreateIndexSqlArgs} indexData - Index data.
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  // fallow-ignore-next-line unused-class-member -- consumed through Migration#getDriver's base-typed boundary
  async createIndexSQLs(indexData) {
    this.indexCalls.push(indexData)

    if (this._realDriver) {
      return await this._realDriver.createIndexSQLs(indexData)
    }

    const columns = indexData.columns
      .map((column) => typeof column == "string" ? column : column.getName())
      .join(", ")
    const name = indexData.name

    return [`CREATE INDEX ${name} ON ${indexData.tableName} (${columns})`]
  }

  /**
   * @param {import("../../src/database/drivers/base.js").RemoveIndexSqlArgs} indexData - Index data.
   * @returns {Promise<string[]>} - Resolves with SQL statements.
   */
  async removeIndexSQLs(indexData) {
    this.removeIndexCalls.push(indexData)

    if (this._realDriver) {
      return await this._realDriver.removeIndexSQLs(indexData)
    }

    return [`DROP INDEX ${indexData.name} ON ${indexData.tableName}`]
  }
}
