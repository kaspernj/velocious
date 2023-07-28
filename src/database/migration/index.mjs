class TableColumn {
  constructor(name, args) {
    this.args = args
    this.name = name
  }
}

class TableData {
  columns = []
  indexes = []

  bigint(name, args = {}) {
    const columnArgs = Object.assign({type: "bigint"}, args)
    const column = new TableColumn(name, columnArgs)

    this.columns.push(column)
  }

  string(name, args) {
    const columnArgs = Object.assign({type: "string"}, args)
    const column = new TableColumn(name, columnArgs)

    this.columns.push(column)
  }

  timestamps() {
    const createdAtColumn = new TableColumn("created_at", {type: "datetime"})
    const updatedAtColumn = new TableColumn("updated_at", {type: "datetime"})

    this.columns.push(createdAtColumn)
    this.columns.push(updatedAtColumn)
  }
}

export default class VelociousDatabaseMigration {
  constructor({configuration}) {
    this.configuration = configuration
  }

  async createTable(tableName, callback) {
    const tableData = new TableData()

    callback(tableData)

    const databasePool = this.configuration.databasePool

    const sql = databasePool.createTableSql(tableName, {
      columns: tableData.columns,
      indexes: tableData.indexes
    })

    await databasePool.execute(sql)
  }
}
