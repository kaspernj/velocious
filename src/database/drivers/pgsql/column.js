export default class VelociousDatabaseDriversPgsqlColumn {
  constructor(table, data) {
    this.data = data
    this.table = table
  }

  getName() {
    return this.data.column_name
  }
}
