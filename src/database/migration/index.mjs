import TableData from "../table-data/index.mjs"

export default class VelociousDatabaseMigration {
  constructor({configuration}) {
    this.configuration = configuration
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

  async createTable(tableName, callback) {
    const tableData = new TableData(tableName)

    tableData.integer("id", {null: false, primaryKey: true})

    callback(tableData)

    const databasePool = this.configuration.getDatabasePool()
    const sqls = databasePool.createTableSql(tableData)

    for (const sql of sqls) {
      await databasePool.query(sql)
    }
  }
}
