export default class VelociousDatabaseDriversMssqlColumn {
  constructor(table, data) {
    this.data = data
    this.table = table
  }

  getName = () => this.data["Field"]
}
