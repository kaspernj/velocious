import * as inflection from "inflection"
import TableData, {TableColumn} from "../table-data/index.js"

export default class VelociousDatabaseMigration {
  constructor({configuration}) {
    this.configuration = configuration
  }

  async addColumn(tableName, columnName, columnType, args) {
    const databasePool = this.configuration.getDatabasePool()
    const tableColumnArgs = Object.assign({type: columnType}, args)

    const sqls = databasePool.alterTableSql({
      columns: [new TableColumn(columnName, tableColumnArgs)],
      tableName
    })

    for (const sql of sqls) {
      await databasePool.query(sql)
    }
  }

  async addIndex(tableName, columns, args) {
    const databasePool = this.configuration.getDatabasePool()
    const createIndexArgs = Object.assign(
      {
        columns,
        tableName
      },
      args
    )
    const sql = databasePool.createIndexSql(createIndexArgs)

    await databasePool.query(sql)
  }

  async addForeignKey(tableName, referenceName) {
    const referenceNameUnderscore = inflection.underscore(referenceName)
    const tableNameUnderscore = inflection.underscore(tableName)
    const columnName = `${referenceNameUnderscore}_id`
    const databasePool = this.configuration.getDatabasePool()
    const foreignKeyName = `fk_${tableName}_${referenceName}`
    let sql = ""

    sql += `ALTER TABLE ${databasePool.quoteTable(tableName)}`
    sql += ` ADD CONSTRAINT ${foreignKeyName} `
    sql += ` FOREIGN KEY (${databasePool.quoteColumn(columnName)})`
    sql += ` REFERENCES ${tableNameUnderscore}(id)`

    await databasePool.query(sql)
  }

  async addReference(tableName, referenceName, args) {
    const columnName = `${inflection.underscore(referenceName)}_id`

    await this.addColumn(tableName, columnName, {type: args?.type})
    await this.addIndex(tableName, [columnName], {unique: args?.unique})

    if (args?.foreignKey) {
      await this.addForeignKey(tableName, referenceName)
    }
  }

  async createTable(tableName, callback) {
    const databasePool = this.configuration.getDatabasePool()
    const primaryKeyType = databasePool.primaryKeyType()
    const tableData = new TableData(tableName)

    if (!(primaryKeyType in tableData)) throw new Error(`Unsupported primary key type: ${primaryKeyType}`)

    tableData[primaryKeyType]("id", {autoIncrement: true, null: false, primaryKey: true})

    if (callback) {
      callback(tableData)
    }

    const sqls = databasePool.createTableSql(tableData)

    for (const sql of sqls) {
      await databasePool.query(sql)
    }
  }

  getConnection() {
    const connection = this.configuration.getDatabasePool().getCurrentConnection()

    if (!connection) throw new Error("Couldn't get current connection")

    return connection
  }

  async tableExists(tableName) {
    const exists = await this.getConnection().tableExists(tableName)

    return exists
  }
}
