import {digg} from "diggerize"

export default class VelociousDatabaseDriversPgsqlForeignKey {
  constructor(data) {
    this.data = data
  }

  getColumnName = () => digg(this, "data", "column_name")
  getName = () => digg(this, "data", "constraint_name")
  getTableName = () => digg(this, "data", "table_name")
  getReferencedColumnName = () => digg(this, "data", "foreign_column_name")
  getReferencedTableName = () => digg(this, "data", "foreign_table_name")
}
