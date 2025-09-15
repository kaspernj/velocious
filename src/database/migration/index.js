import * as inflection from "inflection"
import restArgsError from "../../utils/rest-args-error.js"
import TableData, {TableColumn} from "../table-data/index.js"

export default class VelociousDatabaseMigration {
  static onDatabases(databaseIdentifiers) {
    this._databaseIdentifiers = databaseIdentifiers
  }

  static getDatabaseIdentifiers() {
    return this._databaseIdentifiers
  }

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

  async addColumn(tableName, columnName, columnType, args) {
    const tableColumnArgs = Object.assign({type: columnType}, args)
    const tableData = new TableData(tableName)

    tableData.addColumn(columnName, tableColumnArgs)

    const sqls = this._db.alterTableSql(tableData)

    for (const sql of sqls) {
      await this._db.query(sql)
    }
  }

  async addIndex(tableName, columns, args) {
    const createIndexArgs = Object.assign(
      {
        columns,
        tableName
      },
      args
    )
    const sql = this._db.createIndexSql(createIndexArgs)

    await this._db.query(sql)
  }

  async addForeignKey(tableName, referenceName) {
    const referenceNameUnderscore = inflection.underscore(referenceName)
    const tableNameUnderscore = inflection.underscore(tableName)
    const columnName = `${referenceNameUnderscore}_id`
    const foreignKeyName = `fk_${tableName}_${referenceName}`
    let sql = ""

    sql += `ALTER TABLE ${this._db.quoteTable(tableName)}`
    sql += ` ADD CONSTRAINT ${foreignKeyName} `
    sql += ` FOREIGN KEY (${this._db.quoteColumn(columnName)})`
    sql += ` REFERENCES ${tableNameUnderscore}(id)`

    await this._db.query(sql)
  }

  async addReference(tableName, referenceName, args) {
    const columnName = `${inflection.underscore(referenceName)}_id`

    await this.addColumn(tableName, columnName, {type: args?.type})
    await this.addIndex(tableName, [columnName], {unique: args?.unique})

    if (args?.foreignKey) {
      await this.addForeignKey(tableName, referenceName)
    }
  }

  async changeColumnNull(tableName, columnName, nullable) {
    const table = await this.getDriver().getTableByName(tableName)
    const column = await table.getColumnByName(columnName)

    await column.changeNullable(nullable)
  }

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

    const sqls = this._db.createTableSql(tableData)

    for (const sql of sqls) {
      await this._db.query(sql)
    }
  }

  async tableExists(tableName) {
    const exists = await this._db.tableExists(tableName)

    return exists
  }
}
