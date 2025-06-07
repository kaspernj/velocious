export default class VelociousDatabaseDriversMysqlColumn {
  constructor(table, data) {
    this.data = data
    this.table = table
  }

  getName = () => this.data["Field"]
}
