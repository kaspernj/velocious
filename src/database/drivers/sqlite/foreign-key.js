import {digg} from "diggerize"

export default class VelociousDatabaseDriversSqliteForeignKey {
  constructor(data, {tableName}) {
    this.data = data
    this.tableName = tableName
  }

  getColumnName = () => digg(this, "data", "from")
  getName = () => `${this.getTableName()}_${this.getColumnName()}_${this.data.id}`
  getTableName = () => digg(this, "tableName")
  getReferencedColumnName = () => digg(this, "data", "to")
  getReferencedTableName = () => digg(this, "data", "table")
}
