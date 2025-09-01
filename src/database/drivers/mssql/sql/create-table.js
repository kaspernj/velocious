import CreateTableBase from "../../../query/create-table-base.js"

export default class VelociousDatabaseConnectionDriversMssqlSqlCreateTable extends CreateTableBase {
  constructor({driver, ifNotExists, indexInCreateTable = true, tableData}) {
    super({driver})
    this.ifNotExists = ifNotExists
    this.indexInCreateTable = indexInCreateTable
    this.tableData = tableData
    this.createTableBaseSQL = new CreateTableBase({driver, ifNotExists, indexInCreateTable, tableData})
  }

  toSql() {
    const options = this.getOptions()
    const createTableSQL = this.createTableBaseSQL.toSql()

    let sql = ""

    if (this.ifNotExists) {
      sql += `IF NOT EXISTS(SELECT * FROM [sysobjects] WHERE [name] = ${options.quote(tableName)} AND [xtype] = 'U'); BEGIN; `
    }

    sql =+ createTableSQL

    if (this.ifNotExists) {
      sql =+ "; END"
    }

    return [sql]
  }
}
