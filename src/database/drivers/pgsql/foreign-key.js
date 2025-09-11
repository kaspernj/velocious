import {digg} from "diggerize"

export default class VelociousDatabaseDriversPgsqlForeignKey {
  constructor(data) {
    this.data = data
  }

  getColumnName = () => digg(this, "data", "COLUMN_NAME")
  getName = () => digg(this, "data", "CONSTRAINT_NAME")
  getTableName = () => digg(this, "data", "TABLE_NAME")
  getReferencedColumnName = () => digg(this, "data", "REFERENCED_COLUMN_NAME")
  getReferencedTableName = () => digg(this, "data", "REFERENCED_TABLE_NAME")
}
