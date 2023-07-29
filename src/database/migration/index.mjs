import TableData from "../table-data/index.mjs"

export default class VelociousDatabaseMigration {
  constructor({configuration}) {
    this.configuration = configuration
  }

  async createTable(tableName, callback) {
    const tableData = new TableData(tableName)

    callback(tableData)

    const databasePool = this.configuration.databasePool
    const sql = databasePool.createTableSql(tableData)

    await databasePool.query(sql)
  }
}
