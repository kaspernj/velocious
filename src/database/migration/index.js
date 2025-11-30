import * as inflection from "inflection"
import restArgsError from "../../utils/rest-args-error.js"
import TableData from "../table-data/index.js"

export default class VelociousDatabaseMigration {
  static onDatabases(databaseIdentifiers) {
    this._databaseIdentifiers = databaseIdentifiers
  }

  static getDatabaseIdentifiers() {
    return this._databaseIdentifiers
  }

  /**
   * @param {object} args
   * @param {string} args.configuration
   * @param {string} args.databaseIdentifier
   * @param {object} args.db
   */
  constructor({configuration, databaseIdentifier = "default", db}) {
    if (!databaseIdentifier) throw new Error("No database identifier given")
    if (!db) throw new Error("No 'db' given")

    this.configuration = configuration
    this._databaseIdentifier = databaseIdentifier
    this._db = db
  }

  _getDatabaseIdentifier() {
    if (!this._databaseIdentifier) throw new Error("No database identifier set")

    return this._databaseIdentifier
  }

  getDriver() { return this._db }
  connection() { return this.getDriver() }

  /**
   * @param {string} sql
   * @returns {Promise<Array>}
   */
  async execute(sql) {
    return await this.connection().query(sql)
  }

  /**
   * @param {string} tableName
   * @param {string} columnName
   * @param {string} columnType
   * @param {object} args
   * @param {object} args.default
   * @param {object} args.foreignKey
   * @param {object} args.nullable
   * @param {object} args.primaryKey
   * @param {object} args.unique
   * @returns {Promise<void>}
   */
  async addColumn(tableName, columnName, columnType, args) {
    if (!columnType) throw new Error("No column type given")

    const tableColumnArgs = Object.assign({isNewColumn: true, type: columnType}, args)
    const tableData = new TableData(tableName)

    tableData.addColumn(columnName, tableColumnArgs)

    const sqls = await this.getDriver().alterTableSql(tableData)

    for (const sql of sqls) {
      await this.getDriver().query(sql)
    }
  }

  /**
   * @param {string} tableName
   * @param {string} columnName
   * @returns {Promise<void>}
   */
  async removeColumn(tableName, columnName) {
    const tableColumnArgs = Object.assign({dropColumn: true})
    const tableData = new TableData(tableName)

    tableData.addColumn(columnName, tableColumnArgs)

    const sqls = await this.getDriver().alterTableSql(tableData)

    for (const sql of sqls) {
      await this.getDriver().query(sql)
    }
  }

  /**
   * @param {string} tableName
   * @param {Array} columns
   * @param {object} args
   * @param {boolean} args.ifNotExists
   * @param {string} args.name
   * @param {boolean} args.unique
   * @returns {Promise<void>}
   */
  async addIndex(tableName, columns, args) {
    const createIndexArgs = Object.assign(
      {
        columns,
        tableName
      },
      args
    )
    const sql = this.getDriver().createIndexSql(createIndexArgs)

    await this.getDriver().query(sql)
  }

  /**
   * @param {string} tableName
   * @param {string} referenceName
   * @returns {Promise<void>}
   */
  async addForeignKey(tableName, referenceName) {
    const referenceNameUnderscore = inflection.underscore(referenceName)
    const tableNameUnderscore = inflection.underscore(tableName)
    const columnName = `${referenceNameUnderscore}_id`
    const foreignKeyName = `fk_${tableName}_${referenceName}`

    await this.getDriver().addForeignKey(
      tableName,
      columnName,
      tableNameUnderscore,
      "id",
      {
        isNewForeignKey: true,
        name: foreignKeyName
      }
    )
  }

  /**
   * @param {string} tableName
   * @param {string} referenceName
   * @param {object} args
   * @param {boolean} args.foreignKey
   * @param {string} args.type
   * @param {boolean} args.unique
   * @returns {Promise<void>}
   */
  async addReference(tableName, referenceName, args) {
    const {foreignKey, type, unique, ...restArgs} = args
    const columnName = `${inflection.underscore(referenceName)}_id`

    restArgsError(restArgs)

    await this.addColumn(tableName, columnName, type || "integer")
    await this.addIndex(tableName, [columnName], {unique: unique})

    if (foreignKey) {
      await this.addForeignKey(tableName, referenceName)
    }
  }

  /**
   * @param {string} tableName
   * @param {string} referenceName
   * @returns {Promise<void>}
   */
  async removeReference(tableName, referenceName) {
    const columnName = `${inflection.underscore(referenceName)}_id`

    this.removeColumn(tableName, columnName)
  }

  /**
   * @param {string} tableName
   * @param {string} columnName
   * @param {boolean} nullable
   * @returns {Promise<void>}
   */
  async changeColumnNull(tableName, columnName, nullable) {
    const table = await this.getDriver().getTableByName(tableName)
    const column = await table.getColumnByName(columnName)

    await column.changeNullable(nullable)
  }

  /**
   * @param {string} tableName
   * @param {string} columnName
   * @returns {Promise<boolean>}
   */
  async columnExists(tableName, columnName) {
    const table = await this.getDriver().getTableByName(tableName)
    const column = await table.getColumnByName(columnName)

    return Boolean(column)
  }

  /**
   * @param {string} tableName
   * @param {function() : void} arg1
   * @returns {Promise<void>}
   */
  /**
   * @param {string} tableName
   * @param {object} arg1
   * @param {function() : void} arg2
   * @returns {Promise<void>}
   */
  async createTable(tableName, arg1, arg2) {
    let args
    let callback

    if (typeof arg1 == "function") {
      args = {}
      callback = arg1
    } else {
      args = arg1
      callback = arg2
    }

    const {id = {}, ...restArgs} = args
    const databaseIdentifier = this._getDatabaseIdentifier()
    const databasePool = this.configuration.getDatabasePool(databaseIdentifier)
    const {default: idDefault, type: idType = databasePool.primaryKeyType(), ...restArgsId} = id
    const tableData = new TableData(tableName)

    restArgsError(restArgs)
    restArgsError(restArgsId)

    if (!(idType in tableData)) throw new Error(`Unsupported primary key type: ${idType}`)

    if (id !== false) {
      tableData[idType]("id", {autoIncrement: true, default: idDefault, null: false, primaryKey: true})
    }

    if (callback) {
      callback(tableData)
    }

    const sqls = this.getDriver().createTableSql(tableData)

    for (const sql of sqls) {
      await this._db.query(sql)
    }
  }

  /**
   * @param {string} tableName
   * @returns {Promise<void>}
   */
  async dropTable(tableName) {
    await this.getDriver().dropTable(tableName)
  }

  /**
   * @param {string} tableName
   * @param {string} oldColumnName
   * @param {string} newColumnName
   * @returns {Promise<void>}
   */
  async renameColumn(tableName, oldColumnName, newColumnName) {
    await this.getDriver().renameColumn(tableName, oldColumnName, newColumnName)
  }

  /**
   * @param {string} tableName
   * @returns {Promise<boolean>}
   */
  async tableExists(tableName) {
    const exists = await this.getDriver().tableExists(tableName)

    return exists
  }
}
